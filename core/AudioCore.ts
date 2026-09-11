/**
 * NusaAudio3D — AudioCore
 *
 * Owns the single `AudioContext` and the master signal chain every {@link Bus}
 * ultimately feeds into:
 *
 *   busInput (summing point) -> DC blocker -> [warmth saturator] -> limiter
 *   -> master gain -> analyser -> destination
 *
 * This is where the "make the output sound smoother & cleaner" work
 * actually happens at the whole-mix level: sub-sonic rumble is removed,
 * transient peaks are caught by a transparent limiter before they can clip,
 * and an optional gentle saturator rounds off harshness.
 */
import { createDCBlocker, createMasterLimiter, createWarmthSaturator } from "../fx/Filters";
import { clamp } from "../utils/MathUtils";

export interface AudioCoreOptions {
  context?: AudioContext;
  masterLimiter?: boolean;
  masterWarmth?: boolean;
}

type ContextConstructor = new (options?: AudioContextOptions) => AudioContext;

export class AudioCore {
  readonly context: AudioContext;
  /** Summing input every Bus connects into. */
  readonly busInput: GainNode;
  readonly analyser: AnalyserNode;
  private readonly dcBlocker: BiquadFilterNode;
  private readonly limiter: DynamicsCompressorNode | null;
  private readonly warmth: WaveShaperNode | null;
  private readonly masterGain: GainNode;
  private disposed = false;

  constructor(options: AudioCoreOptions = {}) {
    this.context =
      options.context ??
      new (((window as unknown as { webkitAudioContext?: ContextConstructor }).webkitAudioContext ??
        AudioContext) as ContextConstructor)({ latencyHint: "interactive" });

    this.busInput = this.context.createGain();
    this.busInput.gain.value = 1;

    this.dcBlocker = createDCBlocker(this.context);

    this.warmth = options.masterWarmth ? createWarmthSaturator(this.context, 0.12) : null;
    this.limiter = options.masterLimiter !== false ? createMasterLimiter(this.context) : null;

    this.masterGain = this.context.createGain();
    this.masterGain.gain.value = 1;

    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.8;

    // Wire the fixed master chain.
    let node: AudioNode = this.busInput;
    node.connect(this.dcBlocker);
    node = this.dcBlocker;
    if (this.warmth) {
      node.connect(this.warmth);
      node = this.warmth;
    }
    if (this.limiter) {
      node.connect(this.limiter);
      node = this.limiter;
    }
    node.connect(this.masterGain);
    this.masterGain.connect(this.analyser);
    this.analyser.connect(this.context.destination);
  }

  /** Must be called from a user-gesture handler to satisfy autoplay policies. */
  async resume(): Promise<void> {
    if (this.context.state !== "running") {
      await this.context.resume();
    }
  }

  async suspend(): Promise<void> {
    if (this.context.state === "running") {
      await this.context.suspend();
    }
  }

  get currentTime(): number {
    return this.context.currentTime;
  }

  get state(): AudioContextState {
    return this.context.state;
  }

  /** Sets overall master output volume (linear gain), smoothly glided. */
  setMasterVolume(value: number, fadeTime = 0.05): void {
    const target = Math.max(0, value);
    this.masterGain.gain.setTargetAtTime(target, this.context.currentTime, Math.max(0.001, fadeTime));
  }

  getMasterVolume(): number {
    return this.masterGain.gain.value;
  }

  /** Reads normalized (0..1) time-domain RMS level, handy for VU meters. */
  getOutputLevel(): number {
    const data = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(data);
    let sumSquares = 0;
    for (let i = 0; i < data.length; i++) {
      const normalized = (data[i] - 128) / 128;
      sumSquares += normalized * normalized;
    }
    return clamp(Math.sqrt(sumSquares / data.length), 0, 1);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.busInput.disconnect();
      this.dcBlocker.disconnect();
      this.warmth?.disconnect();
      this.limiter?.disconnect();
      this.masterGain.disconnect();
      this.analyser.disconnect();
    } catch {
      // Nodes may already be disconnected — safe to ignore.
    }
    void this.context.close().catch(() => undefined);
  }
}
