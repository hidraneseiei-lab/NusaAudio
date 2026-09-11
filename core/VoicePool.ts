/**
 * NusaAudio3D — VoicePool & Voice
 *
 * The heart of the "no PannerNode churn" design. A fixed number of real
 * audio chains (`Panner -> OcclusionFilter -> AirAbsorption -> Gain`) are
 * created exactly once at startup and reused for the lifetime of the
 * engine. `Sound3D` instances are just lightweight logical descriptors —
 * only a `Sound3D` that is actually audible right now owns one of these
 * `Voice` objects.
 *
 * When every voice is busy and a new, equal-or-higher priority sound wants
 * to play, the least important currently-playing voice is stolen: it is
 * faded out over `VOICE_STEAL_FADE_TIME` seconds (never hard-cut, so no
 * clicks) and handed to the new sound. The sound that lost its voice keeps
 * "logically" playing (state becomes `"virtual"`) and silently reclaims a
 * voice — resuming from the correct offset — the instant one frees up.
 */
import { CLEAR_CUTOFF_HZ, VOICE_STEAL_FADE_TIME } from "../constants";
import { createAirAbsorptionFilter, createOcclusionFilter } from "../fx/Filters";
import type { Bus } from "./Bus";
import type { Sound3D } from "./Sound3D";

export interface Voice {
  readonly id: number;
  readonly panner: PannerNode;
  readonly occlusionFilter: BiquadFilterNode;
  readonly airFilter: BiquadFilterNode;
  readonly gain: GainNode;
  /** Auxiliary send feeding whichever ReverbZone is currently dominant. */
  readonly reverbSend: GainNode;
  source: AudioBufferSourceNode | null;
  sound: Sound3D | null;
  busName: string | null;
  zoneId: string | null;
  active: boolean;
  priority: number;
  /** context-time this voice's current playback started (minus offset). */
  anchorTime: number;
  /** buffer-time offset corresponding to `anchorTime`. */
  anchorOffset: number;
  /** bumped every (re)assignment so async `onended` callbacks can detect staleness. */
  generation: number;
}

export class VoicePool {
  readonly voices: Voice[] = [];
  private readonly context: BaseAudioContext;
  private readonly resolveBus: (name: string) => Bus;
  private nextId = 0;

  constructor(context: BaseAudioContext, maxVoices: number, resolveBus: (name: string) => Bus) {
    this.context = context;
    this.resolveBus = resolveBus;
    for (let i = 0; i < Math.max(1, maxVoices); i++) {
      this.voices.push(this.createVoice());
    }
  }

  private createVoice(): Voice {
    const context = this.context;
    const panner = context.createPanner();
    panner.panningModel = "HRTF";
    panner.distanceModel = "inverse";
    panner.refDistance = 1;
    panner.maxDistance = 10000;
    panner.rolloffFactor = 1;
    panner.coneInnerAngle = 360;
    panner.coneOuterAngle = 360;
    panner.coneOuterGain = 0;

    const occlusionFilter = createOcclusionFilter(context);
    const airFilter = createAirAbsorptionFilter(context);

    const gain = context.createGain();
    gain.gain.value = 0;

    const reverbSend = context.createGain();
    reverbSend.gain.value = 0;

    panner.connect(occlusionFilter);
    occlusionFilter.connect(airFilter);
    airFilter.connect(gain);
    gain.connect(reverbSend);

    return {
      id: this.nextId++,
      panner,
      occlusionFilter,
      airFilter,
      gain,
      reverbSend,
      source: null,
      sound: null,
      busName: null,
      zoneId: null,
      active: false,
      priority: -Infinity,
      anchorTime: 0,
      anchorOffset: 0,
      generation: 0,
    };
  }

  /** Connects a voice's dry output to the named bus, disconnecting any previous bus. */
  connectToBus(voice: Voice, busName: string): void {
    if (voice.busName === busName) return;
    if (voice.busName) {
      try {
        voice.gain.disconnect(this.resolveBus(voice.busName).input);
      } catch {
        // Already disconnected — fine.
      }
    }
    voice.busName = busName;
    voice.gain.connect(this.resolveBus(busName).input);
  }

  private disconnectBus(voice: Voice): void {
    if (!voice.busName) return;
    try {
      voice.gain.disconnect(this.resolveBus(voice.busName).input);
    } catch {
      // Already disconnected.
    }
    voice.busName = null;
  }

  /** Finds an idle voice, or steals the lowest-priority active one that is <= `priority`. */
  allocate(priority: number): Voice | null {
    const free = this.voices.find((v) => !v.active);
    if (free) return free;

    let candidate: Voice | null = null;
    for (const voice of this.voices) {
      if (!voice.active) continue;
      if (voice.priority > priority) continue;
      if (!candidate || voice.priority < candidate.priority || (voice.priority === candidate.priority && voice.anchorTime < candidate.anchorTime)) {
        candidate = voice;
      }
    }
    if (!candidate) return null;

    this.steal(candidate);
    return candidate;
  }

  /** Forcibly fades out & frees a voice so it can be immediately reused. */
  private steal(voice: Voice): void {
    const stolenSound = voice.sound;
    this.fadeOutAndStopSource(voice, VOICE_STEAL_FADE_TIME);
    this.release(voice);
    if (stolenSound) stolenSound.handleVoiceStolen();
  }

  /** Releases a voice back to the free pool (does not stop any already-scheduled fade). */
  release(voice: Voice): void {
    voice.active = false;
    voice.sound = null;
    voice.priority = -Infinity;
    this.disconnectBus(voice);
    if (voice.zoneId) {
      voice.zoneId = null;
      try {
        voice.reverbSend.disconnect();
      } catch {
        // Already disconnected.
      }
    }
  }

  /** Smoothly silences & stops a voice's current source without freeing the voice slot. */
  fadeOutAndStopSource(voice: Voice, fadeTime: number): void {
    const now = this.context.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
    voice.gain.gain.linearRampToValueAtTime(0, now + Math.max(0.001, fadeTime));
    const source = voice.source;
    const generation = voice.generation;
    if (source) {
      try {
        source.stop(now + Math.max(0.001, fadeTime) + 0.01);
      } catch {
        // Already stopped.
      }
    }
    // Reset the occlusion/air filters back to "clear" so a reused voice
    // doesn't start muffled for its next sound.
    voice.occlusionFilter.frequency.cancelScheduledValues(now);
    voice.occlusionFilter.frequency.setTargetAtTime(CLEAR_CUTOFF_HZ, now, 0.05);
    voice.airFilter.gain.cancelScheduledValues(now);
    voice.airFilter.gain.setTargetAtTime(0, now, 0.05);
    window.setTimeout(
      () => {
        if (voice.generation === generation) {
          voice.source = null;
        }
      },
      Math.max(1, (fadeTime + 0.02) * 1000),
    );
  }

  dispose(): void {
    for (const voice of this.voices) {
      try {
        voice.source?.stop();
      } catch {
        // Already stopped.
      }
      voice.panner.disconnect();
      voice.occlusionFilter.disconnect();
      voice.airFilter.disconnect();
      voice.gain.disconnect();
      voice.reverbSend.disconnect();
    }
  }
}
