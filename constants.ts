/**
 * NusaAudio3D — global constants & sane defaults.
 * Centralised here so every module tunes itself the same way.
 */

/** Default number of concurrent real voice chains. */
export const DEFAULT_MAX_VOICES = 32;

/** Default global doppler factor (1 = physically accurate). */
export const DEFAULT_DOPPLER_FACTOR = 1;

/** Speed of sound in metres/second (dry air, ~20°C). Used as "world units/s". */
export const DEFAULT_SPEED_OF_SOUND = 343.3;

/** Default occlusion raycast budget per `update()` call. */
export const DEFAULT_MAX_OCCLUSION_RAYS_PER_FRAME = 6;

/** Default mix buses created automatically when the engine initializes. */
export const DEFAULT_BUSES = ["music", "sfx", "voice", "ui"] as const;

/** Default exponential-smoothing time constant (seconds) for glided params. */
export const DEFAULT_SMOOTHING_TIME = 0.05;

/** Short click-free fade used for stop/steal/volume transitions. */
export const DEFAULT_FADE_TIME = 0.05;

/** Voice-steal crossfade duration — long enough to be inaudible as a click. */
export const VOICE_STEAL_FADE_TIME = 0.02;

/** Minimum distance clamp to avoid division blow-ups in inverse falloff. */
export const MIN_DISTANCE_EPSILON = 0.01;

/** Occlusion low-pass frequency when a sound is fully occluded (Hz). */
export const OCCLUDED_CUTOFF_HZ = 500;

/** Occlusion low-pass frequency when a sound is fully clear (Hz). */
export const CLEAR_CUTOFF_HZ = 20000;

/** Occlusion smoothing lambda (higher = snappier fade of the muffling). */
export const OCCLUSION_SMOOTHING_LAMBDA = 6;

/** Extra gain attenuation (linear) applied at full occlusion, on top of the filter. */
export const OCCLUDED_GAIN_MULTIPLIER = 0.35;

/** Reference distance (world units) at which air-absorption starts rolling off highs. */
export const AIR_ABSORPTION_REFERENCE_DISTANCE = 10;

/** Minimum high-shelf frequency reached by air absorption at extreme distance (Hz). */
export const AIR_ABSORPTION_MIN_HZ = 1200;

/** Clamp range for the computed doppler playback-rate multiplier. */
export const DOPPLER_RATE_MIN = 0.25;
export const DOPPLER_RATE_MAX = 4;

/** Master limiter defaults — transparent brick-wall safety net. */
export const MASTER_LIMITER_THRESHOLD_DB = -2;
export const MASTER_LIMITER_KNEE_DB = 1;
export const MASTER_LIMITER_RATIO = 20;
export const MASTER_LIMITER_ATTACK = 0.002;
export const MASTER_LIMITER_RELEASE = 0.15;

/** DC-blocker high-pass frequency (Hz) — removes sub-audible rumble/offset. */
export const DC_BLOCKER_HZ = 20;

/** Reverb zone default parameters. */
export const DEFAULT_REVERB_WET = 0.35;
export const DEFAULT_REVERB_FALLOFF = 8;
export const REVERB_SEND_SMOOTHING_TIME = 0.15;

/** Semantic version reported by `NusaAudio3D.VERSION`. */
export const LIBRARY_VERSION = "2.0.0";
