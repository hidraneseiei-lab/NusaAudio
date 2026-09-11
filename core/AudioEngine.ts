/**
 * NusaAudio3D — AudioEngine (facade)
 *
 * The single entry point applications talk to. Wires together the
 * `AudioCore` master chain, `Listener3D`, named `Bus`es, `AssetManager`,
 * `VoicePool`, `OcclusionSystem` and `ReverbManager`, and drives them all
 * from one `update(dt)` call per frame.
 *
 * IMPORTANT: this class is intentionally engine-agnostic. It knows nothing
 * about canvases, WebGL, physics or game loops — you call `update()`
 * yourself from whatever loop your project already has (see the Demo app
 * for a worked example using `requestAnimationFrame`).
 */
import { DEFAULT_BUSES, DEFAULT_DOPPLER_FACTOR, DEFAULT_MAX_OCCLUSION_RAYS_PER_FRAME, DEFAULT_MAX_VOICES, DEFAULT_SMOOTHING_TIME, DEFAULT_SPEED_OF_SOUND, LIBRARY_VERSION } from "../constants";
import type { NusaAudio3DOptions, ReverbZoneOptions, Sound3DOptions } from "../types";
import { EventEmitter } from "../utils/EventEmitter";
import { AssetManager } from "./AssetManager";
import { AudioCore } from "./AudioCore";
import { Bus } from "./Bus";
import type { EngineContext } from "./EngineContext";
import { Listener3D } from "./Listener";
import { OcclusionSystem, type OcclusionRaycaster } from "../fx/OcclusionSystem";
import { ReverbManager, type ReverbZone } from "../fx/ReverbZone";
import { Sound3D } from "./Sound3D";
import { VoicePool } from "./VoicePool";

interface AudioEngineEvents {
  ready: [];
  soundcreated: [Sound3D];
  sounddisposed: [Sound3D];
  [key: string]: unknown[];
}

export class NusaAudio3D extends EventEmitter<AudioEngineEvents> implements EngineContext {
  static readonly VERSION = LIBRARY_VERSION;

  readonly core: AudioCore;
  readonly listener: Listener3D;
  readonly assets: AssetManager;
  readonly voicePool: VoicePool;
  readonly occlusion: OcclusionSystem;
  readonly reverb: ReverbManager;

  dopplerFactor: number;
  speedOfSound: number;
  smoothingTime: number;

  private readonly buses = new Map<string, Bus>();
  private readonly sounds = new Set<Sound3D>();
  private rafHandle: number | null = null;
  private lastFrameTime = 0;

  constructor(options: NusaAudio3DOptions = {}) {
    super();

    this.core = new AudioCore({
      context: options.context,
      masterLimiter: options.masterLimiter,
      masterWarmth: options.masterWarmth,
    });

    this.listener = new Listener3D(this.core.context);
    this.assets = new AssetManager(this.core.context);

    this.dopplerFactor = options.dopplerFactor ?? DEFAULT_DOPPLER_FACTOR;
    this.speedOfSound = options.speedOfSound ?? DEFAULT_SPEED_OF_SOUND;
    this.smoothingTime = options.smoothingTime ?? DEFAULT_SMOOTHING_TIME;

    const busNames = options.buses ?? Array.from(DEFAULT_BUSES);
    for (const name of busNames) this.createBus(name);

    this.voicePool = new VoicePool(this.core.context, options.maxVoices ?? DEFAULT_MAX_VOICES, (name) => this.getBus(name));
    this.occlusion = new OcclusionSystem();
    this.occlusion.maxRaysPerFrame = options.maxOcclusionRaysPerFrame ?? DEFAULT_MAX_OCCLUSION_RAYS_PER_FRAME;
    this.reverb = new ReverbManager(this.core.context, this.core.busInput);
  }

  get context(): AudioContext {
    return this.core.context;
  }

  get isRunning(): boolean {
    return this.core.state === "running";
  }

  /** Resumes the AudioContext. Must be called from within a user-gesture handler. */
  async init(): Promise<void> {
    await this.core.resume();
    this.emit("ready");
  }

  // ---------------------------------------------------------------------
  // Sounds
  // ---------------------------------------------------------------------

  createSound3D(options: Sound3DOptions = {}): Sound3D {
    if (options.bus && !this.buses.has(options.bus)) this.createBus(options.bus);
    const sound = new Sound3D(this, options);
    this.sounds.add(sound);
    this.emit("soundcreated", sound);
    return sound;
  }

  removeSound3D(sound: Sound3D): void {
    if (!this.sounds.has(sound)) return;
    sound.dispose();
    this.sounds.delete(sound);
    this.emit("sounddisposed", sound);
  }

  listSounds(): Sound3D[] {
    return Array.from(this.sounds);
  }

  // ---------------------------------------------------------------------
  // Buses
  // ---------------------------------------------------------------------

  createBus(name: string): Bus {
    const existing = this.buses.get(name);
    if (existing) return existing;
    const bus = new Bus(this.core.context, name, this.core.busInput);
    this.buses.set(name, bus);
    return bus;
  }

  getBus(name: string): Bus {
    return this.createBus(name);
  }

  listBuses(): Bus[] {
    return Array.from(this.buses.values());
  }

  // ---------------------------------------------------------------------
  // Reverb zones
  // ---------------------------------------------------------------------

  addReverbZone(options: ReverbZoneOptions): ReverbZone {
    return this.reverb.addZone(options);
  }

  removeReverbZone(idOrZone: string | ReverbZone): void {
    this.reverb.removeZone(idOrZone);
  }

  // ---------------------------------------------------------------------
  // Occlusion
  // ---------------------------------------------------------------------

  setOcclusionRaycaster(fn: OcclusionRaycaster | null): void {
    this.occlusion.setRaycaster(fn);
  }

  // ---------------------------------------------------------------------
  // Master
  // ---------------------------------------------------------------------

  setMasterVolume(value: number, fadeTime = 0.05): void {
    this.core.setMasterVolume(value, fadeTime);
  }

  getMasterVolume(): number {
    return this.core.getMasterVolume();
  }

  getOutputLevel(): number {
    return this.core.getOutputLevel();
  }

  // ---------------------------------------------------------------------
  // Update loop
  // ---------------------------------------------------------------------

  /** Advances listener/sound/occlusion/reverb state. Call once per frame. */
  update(dt: number): void {
    this.listener.update(dt);
    const activeSounds: Sound3D[] = [];
    for (const sound of this.sounds) {
      sound.update(dt);
      if (sound.isPlaying()) activeSounds.push(sound);
    }
    this.occlusion.update(activeSounds, this.listener, dt);
  }

  /** Convenience: drives `update()` automatically via `requestAnimationFrame`. Optional — see README. */
  startAutoUpdate(): void {
    if (this.rafHandle !== null) return;
    this.lastFrameTime = performance.now();
    const tick = (time: number) => {
      const dt = Math.min(0.1, (time - this.lastFrameTime) / 1000);
      this.lastFrameTime = time;
      this.update(dt);
      this.rafHandle = requestAnimationFrame(tick);
    };
    this.rafHandle = requestAnimationFrame(tick);
  }

  stopAutoUpdate(): void {
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
  }

  /** @internal Implements {@link EngineContext.notify} — thin, type-erased bridge to `emit`. */
  notify(event: string, payload?: unknown): void {
    this.emit(event as keyof AudioEngineEvents, payload as never);
  }

  dispose(): void {
    this.stopAutoUpdate();
    for (const sound of this.sounds) sound.dispose();
    this.sounds.clear();
    for (const bus of this.buses.values()) bus.dispose();
    this.buses.clear();
    this.voicePool.dispose();
    this.reverb.dispose();
    this.core.dispose();
    this.removeAllListeners();
  }
}
