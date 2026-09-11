/**
 * NusaAudio3D — Sound3D
 *
 * A logical 3D emitter. This object always exists and can always be told to
 * play/pause/stop/move — whether or not it currently owns a real `Voice`.
 * When the voice pool is full, a lower-or-equal priority sound simply keeps
 * "playing" in a virtual (silent) state and seamlessly reclaims audio the
 * instant a voice frees up, resuming from the correct offset.
 */
import {
  AIR_ABSORPTION_MIN_HZ,
  AIR_ABSORPTION_REFERENCE_DISTANCE,
  CLEAR_CUTOFF_HZ,
  DOPPLER_RATE_MAX,
  DOPPLER_RATE_MIN,
  MIN_DISTANCE_EPSILON,
  OCCLUDED_CUTOFF_HZ,
  OCCLUDED_GAIN_MULTIPLIER,
  OCCLUSION_SMOOTHING_LAMBDA,
} from "../constants";
import type { DistanceModel, PanningModel, SoundState, Sound3DOptions, Vector3 } from "../types";
import { EventEmitter } from "../utils/EventEmitter";
import { clamp, damp, lerp, vec3 } from "../utils/MathUtils";
import type { EngineContext } from "./EngineContext";
import type { Voice } from "./VoicePool";

let nextSoundId = 1;

interface Sound3DEvents {
  play: [];
  stop: [];
  pause: [];
  ended: [];
  virtualized: [];
  reclaimed: [];
  [key: string]: unknown[];
}

export class Sound3D extends EventEmitter<Sound3DEvents> {
  readonly id: number = nextSoundId++;
  userData: Record<string, unknown>;

  private engine: EngineContext;
  private buffer: AudioBuffer | null;
  private busName: string;
  private loop: boolean;
  private volume: number;
  private playbackRate: number;

  private position: Vector3;
  private orientation: Vector3;
  private explicitVelocity: Vector3 | null;
  private previousPosition: Vector3;
  private autoVelocity: Vector3 = [0, 0, 0];

  minDistance: number;
  maxDistance: number;
  rolloffFactor: number;
  distanceModel: DistanceModel;
  panningModel: PanningModel;
  coneInnerAngle: number;
  coneOuterAngle: number;
  coneOuterGain: number;
  priority: number;
  dopplerEnabled: boolean;
  occlusionEnabled: boolean;
  airAbsorption: boolean;

  private state: SoundState = "stopped";
  private voice: Voice | null = null;
  private pausedOffset = 0;
  /** context-time playback logically started at, minus any pause offset — used to compute the resume point. */
  private logicalStartTime = 0;
  private smoothedOcclusion = 0;

  constructor(engine: EngineContext, options: Sound3DOptions = {}) {
    super();
    this.engine = engine;
    this.buffer = options.buffer ?? null;
    this.busName = options.bus ?? "sfx";
    this.loop = options.loop ?? false;
    this.volume = options.volume ?? 1;
    this.playbackRate = options.playbackRate ?? 1;

    this.position = options.position ? vec3.clone(options.position) : [0, 0, 0];
    this.previousPosition = vec3.clone(this.position);
    this.orientation = options.orientation ? vec3.clone(options.orientation) : [0, 0, -1];
    this.explicitVelocity = options.velocity ?? null;

    this.minDistance = options.minDistance ?? 1;
    this.maxDistance = options.maxDistance ?? 10000;
    this.rolloffFactor = options.rolloffFactor ?? 1;
    this.distanceModel = options.distanceModel ?? "inverse";
    this.panningModel = options.panningModel ?? "HRTF";
    this.coneInnerAngle = options.coneInnerAngle ?? 360;
    this.coneOuterAngle = options.coneOuterAngle ?? 360;
    this.coneOuterGain = options.coneOuterGain ?? 0;
    this.priority = options.priority ?? 0;
    this.dopplerEnabled = options.dopplerEnabled ?? true;
    this.occlusionEnabled = options.occlusionEnabled ?? true;
    this.airAbsorption = options.airAbsorption ?? true;
    this.userData = options.userData ?? {};
  }

  // ---------------------------------------------------------------------
  // Playback control
  // ---------------------------------------------------------------------

  /** Starts playback (or resumes from a paused offset). `when` delays start by N seconds. */
  play(when = 0): this {
    if (!this.buffer) {
      throw new Error("NusaAudio3D: Sound3D.play() called with no buffer set. Call setBuffer() first.");
    }
    // Already playing (audibly or virtually) — calling play() again must be a
    // no-op, otherwise we'd reset a virtual sound's logical playback offset.
    if (this.state === "playing" || this.state === "virtual") return this;

    const offset = this.state === "paused" ? this.pausedOffset : 0;
    this.state = "playing";
    this.logicalStartTime = this.engine.context.currentTime + when - offset;
    this.tryAcquireVoice(offset, when);
    this.emit("play");
    return this;
  }

  /** Stops playback entirely (fading out to avoid clicks) and releases any owned voice. */
  stop(fadeTime = 0.03): this {
    if (this.state === "stopped") return this;
    if (this.voice) {
      this.engine.voicePool.fadeOutAndStopSource(this.voice, fadeTime);
      this.engine.voicePool.release(this.voice);
      this.voice = null;
    }
    this.state = "stopped";
    this.pausedOffset = 0;
    this.emit("stop");
    return this;
  }

  /** Pauses playback, remembering the exact offset to resume from later. */
  pause(): this {
    if (this.state !== "playing" && this.state !== "virtual") return this;
    this.pausedOffset = this.getPlaybackOffset();
    if (this.voice) {
      this.engine.voicePool.fadeOutAndStopSource(this.voice, 0.02);
      this.engine.voicePool.release(this.voice);
      this.voice = null;
    }
    this.state = "paused";
    this.emit("pause");
    return this;
  }

  /** Resumes a paused sound from where it left off. Equivalent to `play()`. */
  resume(): this {
    if (this.state !== "paused") return this;
    return this.play(0);
  }

  setBuffer(buffer: AudioBuffer): this {
    this.buffer = buffer;
    return this;
  }

  getState(): SoundState {
    return this.state;
  }

  isPlaying(): boolean {
    return this.state === "playing" || this.state === "virtual";
  }

  // ---------------------------------------------------------------------
  // Spatial parameters
  // ---------------------------------------------------------------------

  setPosition(x: number, y: number, z: number): this {
    this.position = [x, y, z];
    return this;
  }

  getPosition(): Vector3 {
    return vec3.clone(this.position);
  }

  setOrientation(x: number, y: number, z: number): this {
    this.orientation = vec3.normalize([x, y, z]);
    return this;
  }

  /** Explicitly sets velocity (world units/second) instead of auto-deriving it from motion. */
  setVelocity(x: number, y: number, z: number): this {
    this.explicitVelocity = [x, y, z];
    return this;
  }

  clearVelocityOverride(): this {
    this.explicitVelocity = null;
    return this;
  }

  getVelocity(): Vector3 {
    return this.explicitVelocity ? vec3.clone(this.explicitVelocity) : vec3.clone(this.autoVelocity);
  }

  // ---------------------------------------------------------------------
  // Mix parameters
  // ---------------------------------------------------------------------

  setVolume(value: number, fadeTime = 0.05): this {
    this.volume = Math.max(0, value);
    if (this.voice) {
      const targetGain = this.computeVoiceGain();
      this.voice.gain.gain.setTargetAtTime(targetGain, this.engine.context.currentTime, Math.max(0.001, fadeTime));
    }
    return this;
  }

  getVolume(): number {
    return this.volume;
  }

  setPlaybackRate(rate: number): this {
    this.playbackRate = Math.max(0.01, rate);
    if (this.voice?.source) {
      this.voice.source.playbackRate.setTargetAtTime(this.playbackRate, this.engine.context.currentTime, 0.05);
    }
    return this;
  }

  setBus(name: string): this {
    this.busName = name;
    if (this.voice) this.engine.voicePool.connectToBus(this.voice, name);
    return this;
  }

  getBus(): string {
    return this.busName;
  }

  setPriority(priority: number): this {
    this.priority = priority;
    if (this.voice) this.voice.priority = priority;
    return this;
  }

  setLoop(loop: boolean): this {
    this.loop = loop;
    if (this.voice?.source) this.voice.source.loop = loop;
    return this;
  }

  // ---------------------------------------------------------------------
  // Engine-driven per-frame update (called from AudioEngine.update)
  // ---------------------------------------------------------------------

  /** @internal */
  update(dt: number): void {
    if (dt > 0) {
      if (!this.explicitVelocity) {
        this.autoVelocity = vec3.scale(vec3.sub(this.position, this.previousPosition), 1 / dt);
      }
      this.previousPosition = vec3.clone(this.position);
    }

    if (this.state === "virtual") {
      // A non-looping sound that has silently run past its own duration while
      // virtual has effectively already finished — settle it instead of
      // reviving a "ghost" the instant a voice frees up.
      if (!this.loop && this.buffer) {
        const elapsed = this.engine.context.currentTime - this.logicalStartTime;
        if (elapsed >= this.buffer.duration) {
          this.state = "stopped";
          this.emit("ended");
          return;
        }
      }
      const voice = this.engine.voicePool.allocate(this.priority);
      if (voice) this.attachVoice(voice, this.getPlaybackOffset(), 0);
      return;
    }

    if (this.state !== "playing" || !this.voice) return;

    this.applySpatialParams(this.voice);
    this.applyDoppler(this.voice);
  }

  /** @internal called by VoicePool when a higher-priority sound steals this sound's voice. */
  handleVoiceStolen(): void {
    if (this.state !== "playing") return;
    this.pausedOffset = this.getPlaybackOffset();
    this.voice = null;
    this.state = "virtual";
    this.smoothedOcclusion = 0;
    this.emit("virtualized");
  }

  /** @internal set by OcclusionSystem after a raycast query resolves. */
  applyOcclusionFactor(factor: number, dt: number): void {
    if (!this.voice || !this.occlusionEnabled) return;
    this.smoothedOcclusion = damp(this.smoothedOcclusion, clamp(factor, 0, 1), OCCLUSION_SMOOTHING_LAMBDA, dt);
    const now = this.engine.context.currentTime;
    const cutoff = lerp(CLEAR_CUTOFF_HZ, OCCLUDED_CUTOFF_HZ, this.smoothedOcclusion);
    this.voice.occlusionFilter.frequency.setTargetAtTime(cutoff, now, 0.08);
    const occludedGain = this.computeVoiceGain();
    this.voice.gain.gain.setTargetAtTime(occludedGain, now, 0.08);
  }

  dispose(): void {
    this.stop(0.01);
    this.removeAllListeners();
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  private getPlaybackOffset(): number {
    if (this.state === "paused") return this.pausedOffset;
    const elapsed = this.engine.context.currentTime - this.logicalStartTime;
    if (!this.buffer) return 0;
    if (this.loop) return ((elapsed % this.buffer.duration) + this.buffer.duration) % this.buffer.duration;
    return clamp(elapsed, 0, this.buffer.duration);
  }

  private computeVoiceGain(): number {
    const occlusionMultiplier = this.occlusionEnabled ? lerp(1, OCCLUDED_GAIN_MULTIPLIER, this.smoothedOcclusion) : 1;
    return this.volume * occlusionMultiplier;
  }

  private tryAcquireVoice(offset: number, when: number): void {
    const voice = this.engine.voicePool.allocate(this.priority);
    if (!voice) {
      this.state = "virtual";
      this.emit("virtualized");
      return;
    }
    this.attachVoice(voice, offset, when);
  }

  private attachVoice(voice: Voice, offset: number, when: number): void {
    if (!this.buffer) return;
    const wasVirtual = this.state === "virtual";
    this.state = "playing";

    voice.active = true;
    voice.sound = this;
    voice.priority = this.priority;
    voice.generation += 1;
    const generation = voice.generation;

    this.engine.voicePool.connectToBus(voice, this.busName);

    voice.panner.panningModel = this.panningModel === "HRTF" ? "HRTF" : "equalpower";
    voice.panner.distanceModel = this.distanceModel;
    voice.panner.refDistance = Math.max(MIN_DISTANCE_EPSILON, this.minDistance);
    voice.panner.maxDistance = Math.max(this.minDistance + 1, this.maxDistance);
    voice.panner.rolloffFactor = this.rolloffFactor;
    voice.panner.coneInnerAngle = this.coneInnerAngle;
    voice.panner.coneOuterAngle = this.coneOuterAngle;
    voice.panner.coneOuterGain = this.coneOuterGain;

    const context = this.engine.context;
    const source = context.createBufferSource();
    source.buffer = this.buffer;
    source.loop = this.loop;
    source.playbackRate.value = this.playbackRate;
    source.connect(voice.panner);
    source.onended = () => {
      if (voice.generation !== generation) return; // Voice was reassigned already.
      if (this.loop) return; // Looping sources fire onended only via explicit stop.
      this.state = "stopped";
      this.voice = null;
      this.engine.voicePool.release(voice);
      this.emit("ended");
    };
    voice.source = source;

    // Fade the voice in from silence to avoid a click when reusing a chain.
    const now = context.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(0, now);
    voice.gain.gain.linearRampToValueAtTime(this.computeVoiceGain(), now + 0.015);

    this.applySpatialParams(voice, true);

    try {
      source.start(context.currentTime + Math.max(0, when), offset);
    } catch {
      // Attempting to start an already-started source — extremely unlikely
      // given fresh nodes per attach, but guarded defensively regardless.
    }

    this.voice = voice;
    if (wasVirtual) this.emit("reclaimed");
  }

  private applySpatialParams(voice: Voice, immediate = false): void {
    const context = this.engine.context;
    const tc = immediate ? 0.0001 : this.engine.smoothingTime;
    const [x, y, z] = this.position;
    const [ox, oy, oz] = this.orientation;
    const p = voice.panner;
    const now = context.currentTime;

    if (p.positionX) {
      p.positionX.setTargetAtTime(x, now, tc);
      p.positionY.setTargetAtTime(y, now, tc);
      p.positionZ.setTargetAtTime(z, now, tc);
      p.orientationX.setTargetAtTime(ox, now, tc);
      p.orientationY.setTargetAtTime(oy, now, tc);
      p.orientationZ.setTargetAtTime(oz, now, tc);
    } else {
      p.setPosition?.(x, y, z);
      p.setOrientation?.(ox, oy, oz);
    }

    if (this.airAbsorption) {
      const distance = vec3.distance(this.position, this.engine.listener.getPosition());
      const t = clamp((distance - AIR_ABSORPTION_REFERENCE_DISTANCE) / (this.maxDistance - AIR_ABSORPTION_REFERENCE_DISTANCE || 1), 0, 1);
      const shelfFreq = lerp(CLEAR_CUTOFF_HZ, AIR_ABSORPTION_MIN_HZ, t);
      const shelfGain = lerp(0, -18, t);
      voice.airFilter.frequency.setTargetAtTime(shelfFreq, now, 0.15);
      voice.airFilter.gain.setTargetAtTime(shelfGain, now, 0.15);
    } else {
      voice.airFilter.gain.setTargetAtTime(0, now, 0.15);
    }

    this.engine.reverb.updateVoiceSend(voice, this.position);
  }

  private applyDoppler(voice: Voice): void {
    if (!voice.source) return;
    if (!this.dopplerEnabled || this.engine.dopplerFactor === 0) {
      voice.source.playbackRate.setTargetAtTime(this.playbackRate, this.engine.context.currentTime, 0.1);
      return;
    }

    const listenerPos = this.engine.listener.getPosition();
    const listenerVel = this.engine.listener.getVelocity();
    const soundVel = this.getVelocity();

    const toListener = vec3.normalize(vec3.sub(listenerPos, this.position));
    const speed = this.engine.speedOfSound;
    const factor = this.engine.dopplerFactor;

    const listenerRadialSpeed = vec3.dot(listenerVel, toListener) * factor;
    const sourceRadialSpeed = vec3.dot(soundVel, toListener) * factor;

    const numerator = speed + listenerRadialSpeed;
    const denominator = speed + sourceRadialSpeed;
    const rawShift = denominator !== 0 ? numerator / denominator : 1;
    const shift = clamp(rawShift, DOPPLER_RATE_MIN, DOPPLER_RATE_MAX);

    voice.source.playbackRate.setTargetAtTime(this.playbackRate * shift, this.engine.context.currentTime, 0.05);
  }
}
