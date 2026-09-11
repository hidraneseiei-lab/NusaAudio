/**
 * NusaAudio3D — Bus
 *
 * A named mix group (e.g. "music", "sfx", "voice", "ui"). Every `Sound3D`
 * routes through exactly one bus, so you can duck/mute/fade whole
 * categories of sound at once without touching individual emitters.
 */
import { DEFAULT_FADE_TIME } from "../constants";
import { EventEmitter } from "../utils/EventEmitter";
import { clamp } from "../utils/MathUtils";

interface BusEvents {
  volumechange: [number];
  mute: [boolean];
  [key: string]: unknown[];
}

export class Bus extends EventEmitter<BusEvents> {
  readonly name: string;
  /** Voices / child nodes should connect here. */
  readonly input: GainNode;

  private readonly context: BaseAudioContext;
  private volume = 1;
  private muted = false;
  private volumeBeforeMute = 1;

  constructor(context: BaseAudioContext, name: string, destination: AudioNode) {
    super();
    this.context = context;
    this.name = name;
    this.input = context.createGain();
    this.input.gain.value = 1;
    this.input.connect(destination);
  }

  /** Sets the bus volume (linear gain, 0..~2), glided over `fadeTime` seconds. */
  setVolume(value: number, fadeTime = DEFAULT_FADE_TIME): void {
    this.volume = clamp(value, 0, 4);
    if (!this.muted) {
      this.input.gain.setTargetAtTime(this.volume, this.context.currentTime, Math.max(0.001, fadeTime));
    }
    this.emit("volumechange", this.volume);
  }

  getVolume(): number {
    return this.volume;
  }

  isMuted(): boolean {
    return this.muted;
  }

  mute(fadeTime = DEFAULT_FADE_TIME): void {
    if (this.muted) return;
    this.muted = true;
    this.volumeBeforeMute = this.volume;
    this.input.gain.setTargetAtTime(0, this.context.currentTime, Math.max(0.001, fadeTime));
    this.emit("mute", true);
  }

  unmute(fadeTime = DEFAULT_FADE_TIME): void {
    if (!this.muted) return;
    this.muted = false;
    this.input.gain.setTargetAtTime(this.volumeBeforeMute, this.context.currentTime, Math.max(0.001, fadeTime));
    this.emit("mute", false);
  }

  toggleMute(fadeTime = DEFAULT_FADE_TIME): void {
    if (this.muted) this.unmute(fadeTime);
    else this.mute(fadeTime);
  }

  dispose(): void {
    try {
      this.input.disconnect();
    } catch {
      // Already disconnected.
    }
    this.removeAllListeners();
  }
}
