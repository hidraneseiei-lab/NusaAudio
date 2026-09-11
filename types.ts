/**
 * NusaAudio3D — Shared type definitions.
 *
 * These types are used across the whole library so every module speaks
 * the exact same "language" (positions, distance models, bus names...).
 */

/** A 3D vector expressed as a plain tuple `[x, y, z]`. */
export type Vector3 = [number, number, number];

/** Playback / lifecycle state of a logical {@link Sound3D} emitter. */
export type SoundState = "stopped" | "playing" | "paused" | "virtual";

/** Web Audio distance attenuation models, forwarded straight to `PannerNode`. */
export type DistanceModel = "linear" | "inverse" | "exponential";

/** Web Audio panning models, forwarded straight to `PannerNode`. */
export type PanningModel = "HRTF" | "equalpower";

/** Reverb "character" presets used by the impulse-response generator. */
export type ReverbCharacter = "room" | "hall" | "plate" | "cathedral" | "cave" | "custom";

/** Options accepted by {@link Bus.setVolume} / mute helpers. */
export interface FadeOptions {
  /** Fade duration in seconds. Defaults to a short, click-free ramp. */
  fadeTime?: number;
}

/** Construction options for {@link Sound3D}. */
export interface Sound3DOptions {
  /** Decoded PCM data to play. Can be set later with `setBuffer`. */
  buffer?: AudioBuffer | null;
  /** Name of the {@link Bus} this sound routes through. Defaults to `"sfx"`. */
  bus?: string;
  /** World-space position `[x, y, z]`. Defaults to the origin. */
  position?: Vector3;
  /** Explicit velocity override in units/second. If omitted, velocity is
   * auto-derived every frame from position deltas (recommended). */
  velocity?: Vector3 | null;
  /** Loop the buffer indefinitely. Defaults to `false`. */
  loop?: boolean;
  /** Linear volume (0..1, can exceed 1 for boosted sounds). Defaults to 1. */
  volume?: number;
  /** Playback rate multiplier (1 = normal speed). Defaults to 1. */
  playbackRate?: number;
  /** Distance (world units) at which attenuation begins. Defaults to 1. */
  minDistance?: number;
  /** Distance beyond which the sound is fully attenuated. Defaults to 10000. */
  maxDistance?: number;
  /** How quickly the sound attenuates with distance. Defaults to 1. */
  rolloffFactor?: number;
  /** Distance attenuation curve. Defaults to `"inverse"`. */
  distanceModel?: DistanceModel;
  /** Spatialization algorithm. Defaults to `"HRTF"` for maximum realism. */
  panningModel?: PanningModel;
  /** Inner cone angle in degrees (full volume inside). Defaults to 360. */
  coneInnerAngle?: number;
  /** Outer cone angle in degrees (attenuated volume outside). Defaults to 360. */
  coneOuterAngle?: number;
  /** Gain multiplier applied outside the outer cone. Defaults to 0. */
  coneOuterGain?: number;
  /** Emitter facing direction, used for directional cones. Defaults to `[0, 0, -1]`. */
  orientation?: Vector3;
  /** Voice-stealing priority; higher wins. Defaults to 0. */
  priority?: number;
  /** Enable/disable the doppler pitch shift for this sound. Defaults to `true`. */
  dopplerEnabled?: boolean;
  /** Enable/disable occlusion muffling for this sound. Defaults to `true`. */
  occlusionEnabled?: boolean;
  /** Simulate atmospheric high-frequency absorption over distance. Defaults to `true`. */
  airAbsorption?: boolean;
  /** Arbitrary user data attached to the sound (tags, ids, gameplay refs...). */
  userData?: Record<string, unknown>;
}

/** Options accepted by {@link ImpulseGenerator.generate}. */
export interface ImpulseGeneratorOptions {
  /** Length of the generated tail, in seconds. */
  duration?: number;
  /** Exponential decay exponent — higher decays faster. */
  decay?: number;
  /** Sonic character preset, tweaks brightness / density / decay together. */
  character?: ReverbCharacter;
  /** Silence inserted before the tail starts, in seconds. */
  preDelay?: number;
  /** Stereo channel count for the generated buffer. */
  channels?: number;
  /** Reverses the impulse (swell effect) when `true`. */
  reverse?: boolean;
}

/** Construction options for {@link ReverbZone}. */
export interface ReverbZoneOptions {
  /** Center of the reverberant volume. */
  position: Vector3;
  /** Radius (world units) inside which the zone is at full wet strength. */
  radius: number;
  /** Extra distance beyond `radius` over which the effect fades out smoothly. */
  falloff?: number;
  /** Wet mix amount at full strength, 0..1. */
  wet?: number;
  /** Provide a ready-made impulse response instead of generating one. */
  impulse?: AudioBuffer;
  /** Procedural impulse-response generation options (ignored if `impulse` is set). */
  generate?: ImpulseGeneratorOptions;
  /** Optional identifier; auto-generated if omitted. */
  id?: string;
}

/** Construction options for the {@link NusaAudio3D} engine facade. */
export interface NusaAudio3DOptions {
  /** Total number of real (Panner/Filter/Gain) voice chains. Defaults to 32. */
  maxVoices?: number;
  /** Global doppler intensity multiplier. `0` disables doppler entirely. Defaults to 1. */
  dopplerFactor?: number;
  /** Speed of sound in world-units/second, used by the doppler model. Defaults to 343.3 (m/s). */
  speedOfSound?: number;
  /** Maximum occlusion raycasts issued per `update()` call. Defaults to 6. */
  maxOcclusionRaysPerFrame?: number;
  /** Named mix buses created automatically at init. Defaults to music/sfx/voice/ui. */
  buses?: string[];
  /** Positional smoothing time-constant (seconds) for listener & voices. Defaults to 0.05. */
  smoothingTime?: number;
  /** Enables the transparent brick-wall master limiter. Defaults to `true`. */
  masterLimiter?: boolean;
  /** Enables gentle master saturation for extra "glue" & warmth. Defaults to `false`. */
  masterWarmth?: boolean;
  /** AudioContext to reuse instead of creating a new one. */
  context?: AudioContext;
}
