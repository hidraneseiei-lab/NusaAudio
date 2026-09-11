/**
 * NusaAudio3D — EngineContext
 *
 * A narrow, structural interface describing exactly what a {@link Sound3D}
 * needs from the engine facade (buses, listener, voice pool, reverb...).
 * Depending on this interface instead of importing `AudioEngine` directly
 * keeps `Sound3D.ts` <-> `AudioEngine.ts` free of runtime circular imports.
 */
import type { Bus } from "./Bus";
import type { Listener3D } from "./Listener";
import type { ReverbManager } from "../fx/ReverbZone";
import type { OcclusionSystem } from "../fx/OcclusionSystem";
import type { VoicePool } from "./VoicePool";

export interface EngineContext {
  readonly context: BaseAudioContext;
  readonly listener: Listener3D;
  readonly voicePool: VoicePool;
  readonly reverb: ReverbManager;
  readonly occlusion: OcclusionSystem;
  readonly dopplerFactor: number;
  readonly speedOfSound: number;
  readonly smoothingTime: number;
  getBus(name: string): Bus;
  notify(event: string, payload?: unknown): void;
}
