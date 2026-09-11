/**
 * NusaAudio3D — ReverbZone & ReverbManager
 *
 * Spatial reverb without any shipped impulse-response assets: each zone
 * either generates its own IR via {@link ImpulseGenerator} or accepts a
 * custom `AudioBuffer`. Voices are routed to whichever zone currently has
 * the strongest proximity weight, with a smooth (click-free) crossfade as
 * sounds move between/into/out of zones.
 */
import { DEFAULT_REVERB_FALLOFF, DEFAULT_REVERB_WET, REVERB_SEND_SMOOTHING_TIME } from "../constants";
import type { ReverbZoneOptions, Vector3 } from "../types";
import { EventEmitter } from "../utils/EventEmitter";
import { ImpulseGenerator } from "../utils/ImpulseGenerator";
import { smoothstep, vec3 } from "../utils/MathUtils";
import { createConvolver } from "./Filters";
import type { Voice } from "../core/VoicePool";

let nextZoneId = 1;

export class ReverbZone {
  readonly id: string;
  position: Vector3;
  radius: number;
  falloff: number;
  wet: number;

  /** Node every routed voice's `reverbSend` connects into. */
  readonly input: GainNode;
  private readonly convolver: ConvolverNode;
  private readonly wetGain: GainNode;

  constructor(context: BaseAudioContext, destination: AudioNode, options: ReverbZoneOptions) {
    this.id = options.id ?? `zone-${nextZoneId++}`;
    this.position = vec3.clone(options.position);
    this.radius = Math.max(0, options.radius);
    this.falloff = Math.max(0.001, options.falloff ?? DEFAULT_REVERB_FALLOFF);
    this.wet = options.wet ?? DEFAULT_REVERB_WET;

    const impulse = options.impulse ?? ImpulseGenerator.generate(context, options.generate ?? {});

    this.input = context.createGain();
    this.input.gain.value = 1;
    this.convolver = createConvolver(context, impulse);
    this.wetGain = context.createGain();
    this.wetGain.gain.value = this.wet;

    this.input.connect(this.convolver);
    this.convolver.connect(this.wetGain);
    this.wetGain.connect(destination);
  }

  /** Proximity weight in `[0, 1]`: 1 inside `radius`, smoothly fading to 0 by `radius + falloff`. */
  computeWeight(position: Vector3): number {
    const distance = vec3.distance(position, this.position);
    if (distance <= this.radius) return 1;
    return 1 - smoothstep(this.radius, this.radius + this.falloff, distance);
  }

  setWet(value: number, context: BaseAudioContext, fadeTime = 0.1): void {
    this.wet = Math.max(0, value);
    this.wetGain.gain.setTargetAtTime(this.wet, context.currentTime, Math.max(0.001, fadeTime));
  }

  dispose(): void {
    this.input.disconnect();
    this.convolver.disconnect();
    this.wetGain.disconnect();
  }
}

interface ReverbManagerEvents {
  zoneadded: [ReverbZone];
  zoneremoved: [string];
  [key: string]: unknown[];
}

export class ReverbManager extends EventEmitter<ReverbManagerEvents> {
  private readonly context: BaseAudioContext;
  private readonly destination: AudioNode;
  private readonly zones = new Map<string, ReverbZone>();

  constructor(context: BaseAudioContext, destination: AudioNode) {
    super();
    this.context = context;
    this.destination = destination;
  }

  addZone(options: ReverbZoneOptions): ReverbZone {
    const zone = new ReverbZone(this.context, this.destination, options);
    this.zones.set(zone.id, zone);
    this.emit("zoneadded", zone);
    return zone;
  }

  removeZone(idOrZone: string | ReverbZone): void {
    const id = typeof idOrZone === "string" ? idOrZone : idOrZone.id;
    const zone = this.zones.get(id);
    if (!zone) return;
    zone.dispose();
    this.zones.delete(id);
    this.emit("zoneremoved", id);
  }

  getZone(id: string): ReverbZone | undefined {
    return this.zones.get(id);
  }

  listZones(): ReverbZone[] {
    return Array.from(this.zones.values());
  }

  clear(): void {
    for (const zone of this.zones.values()) zone.dispose();
    this.zones.clear();
  }

  /**
   * Re-evaluates which zone (if any) `position` currently sits in and
   * (re)routes `voice.reverbSend` to it, smoothly crossfading the send
   * level based on proximity weight. Called once per voice per frame from
   * `Sound3D.applySpatialParams`.
   */
  updateVoiceSend(voice: Voice, position: Vector3): void {
    let bestZone: ReverbZone | null = null;
    let bestWeight = 0;
    for (const zone of this.zones.values()) {
      const weight = zone.computeWeight(position);
      if (weight > bestWeight) {
        bestWeight = weight;
        bestZone = zone;
      }
    }

    const now = this.context.currentTime;

    if (!bestZone || bestWeight <= 0.001) {
      if (voice.zoneId) {
        voice.reverbSend.gain.setTargetAtTime(0, now, REVERB_SEND_SMOOTHING_TIME);
        // Fully disconnect a little later, once the fade has settled, to avoid a click.
        const zoneId = voice.zoneId;
        const generation = voice.generation;
        voice.zoneId = null;
        window.setTimeout(() => {
          if (voice.generation !== generation) return;
          const zone = this.zones.get(zoneId);
          if (zone) {
            try {
              voice.reverbSend.disconnect(zone.input);
            } catch {
              // Already disconnected.
            }
          }
        }, REVERB_SEND_SMOOTHING_TIME * 1000 * 3);
      }
      return;
    }

    if (voice.zoneId !== bestZone.id) {
      const previousZoneId = voice.zoneId;
      if (previousZoneId) {
        const previousZone = this.zones.get(previousZoneId);
        if (previousZone) {
          try {
            voice.reverbSend.disconnect(previousZone.input);
          } catch {
            // Already disconnected.
          }
        }
      }
      voice.reverbSend.connect(bestZone.input);
      voice.zoneId = bestZone.id;
      voice.reverbSend.gain.cancelScheduledValues(now);
      voice.reverbSend.gain.setValueAtTime(0, now);
    }

    voice.reverbSend.gain.setTargetAtTime(bestWeight, now, REVERB_SEND_SMOOTHING_TIME);
  }

  dispose(): void {
    this.clear();
    this.removeAllListeners();
  }
}
