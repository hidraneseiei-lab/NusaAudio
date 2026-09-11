/**
 * NusaAudio3D
 * -----------
 * A dependency-free, engine-agnostic 3D spatial audio library built
 * directly on the Web Audio API.
 *
 * Import everything you need from this single entry point:
 *
 * ```ts
 * import { NusaAudio3D } from "nusaaudio3d";
 *
 * const audio = new NusaAudio3D({ maxVoices: 32, dopplerFactor: 1 });
 * await audio.init();
 * ```
 *
 * See the in-repo documentation (Library page) for the full guide.
 */

// --- Facade -----------------------------------------------------------
export { NusaAudio3D } from "./core/AudioEngine";

// --- Core building blocks ----------------------------------------------
export { Sound3D } from "./core/Sound3D";
export { Bus } from "./core/Bus";
export { Listener3D } from "./core/Listener";
export { AssetManager } from "./core/AssetManager";
export { AudioCore } from "./core/AudioCore";
export { VoicePool } from "./core/VoicePool";
export type { Voice } from "./core/VoicePool";
export type { EngineContext } from "./core/EngineContext";

// --- Effects -------------------------------------------------------------
export { OcclusionSystem } from "./fx/OcclusionSystem";
export type { OcclusionRaycaster } from "./fx/OcclusionSystem";
export { ReverbZone, ReverbManager } from "./fx/ReverbZone";
export * as Filters from "./fx/Filters";

// --- Utilities -----------------------------------------------------------
export { EventEmitter } from "./utils/EventEmitter";
export { ImpulseGenerator } from "./utils/ImpulseGenerator";
export * as MathUtils from "./utils/MathUtils";

// --- Constants & types -----------------------------------------------------
export * as Constants from "./constants";
export type {
  Vector3,
  SoundState,
  DistanceModel,
  PanningModel,
  ReverbCharacter,
  FadeOptions,
  Sound3DOptions,
  ImpulseGeneratorOptions,
  ReverbZoneOptions,
  NusaAudio3DOptions,
} from "./types";
