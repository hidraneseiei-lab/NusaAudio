/**
 * NusaAudio3D — Listener3D
 *
 * Wraps the context's `AudioListener` ("the player's ears") with:
 *  - Smooth, glided position/orientation updates (no zipper noise or
 *    teleport artefacts even if the game moves the camera in big steps).
 *  - Automatic velocity derivation (for doppler) from position deltas, or
 *    an explicit override via `setVelocity`.
 *  - Transparent fallback from the modern AudioParam-based positional API
 *    to the legacy `setPosition`/`setOrientation` methods on older engines.
 */
import { DEFAULT_SMOOTHING_TIME } from "../constants";
import type { Vector3 } from "../types";
import { vec3 } from "../utils/MathUtils";

export class Listener3D {
  private readonly context: BaseAudioContext;
  private readonly nativeListener: AudioListener;

  private position: Vector3 = [0, 0, 0];
  private forwardVec: Vector3 = [0, 0, -1];
  private upVec: Vector3 = [0, 1, 0];

  private previousPosition: Vector3 = [0, 0, 0];
  private autoVelocity: Vector3 = [0, 0, 0];
  private explicitVelocity: Vector3 | null = null;

  /** Exponential smoothing time-constant applied to positional glides. */
  smoothingTime: number = DEFAULT_SMOOTHING_TIME;

  private readonly supportsModernAPI: boolean;

  constructor(context: BaseAudioContext) {
    this.context = context;
    this.nativeListener = context.listener;
    this.supportsModernAPI = typeof this.nativeListener.positionX?.setTargetAtTime === "function";
    this.applyImmediate();
  }

  /** Sets the listener's world-space position. Glided unless `immediate`. */
  setPosition(x: number, y: number, z: number, immediate = false): void {
    this.position = [x, y, z];
    if (immediate) {
      this.previousPosition = [x, y, z];
      this.applyImmediate();
    } else {
      this.applyPosition();
    }
  }

  getPosition(): Vector3 {
    return vec3.clone(this.position);
  }

  /** Sets facing direction & up vector (both should be unit-length). Glided unless `immediate`. */
  setOrientation(forward: Vector3, up: Vector3 = [0, 1, 0], immediate = false): void {
    this.forwardVec = vec3.normalize(forward);
    this.upVec = vec3.normalize(up);
    if (immediate) this.applyImmediate();
    else this.applyOrientation();
  }

  getOrientation(): { forward: Vector3; up: Vector3 } {
    return { forward: vec3.clone(this.forwardVec), up: vec3.clone(this.upVec) };
  }

  /** Explicitly overrides the auto-derived velocity (world units/second), used for doppler. */
  setVelocity(x: number, y: number, z: number): void {
    this.explicitVelocity = [x, y, z];
  }

  /** Clears any explicit velocity override, returning to automatic derivation. */
  clearVelocityOverride(): void {
    this.explicitVelocity = null;
  }

  /** Current velocity used for doppler math (explicit override, or auto-derived). */
  getVelocity(): Vector3 {
    return this.explicitVelocity ? vec3.clone(this.explicitVelocity) : vec3.clone(this.autoVelocity);
  }

  /** Must be called once per frame with the elapsed time in seconds. */
  update(dt: number): void {
    if (dt > 0 && !this.explicitVelocity) {
      this.autoVelocity = vec3.scale(vec3.sub(this.position, this.previousPosition), 1 / dt);
    }
    this.previousPosition = vec3.clone(this.position);

    if (!this.supportsModernAPI) {
      // Legacy engines have no built-in smoothing — apply every frame so
      // the browser at least gets fresh (already-final, since we don't
      // glide separately in this branch) values.
      this.applyImmediate();
    }
  }

  private applyPosition(): void {
    const l = this.nativeListener;
    const [x, y, z] = this.position;
    if (this.supportsModernAPI) {
      const t = this.context.currentTime;
      const tc = this.smoothingTime;
      l.positionX!.setTargetAtTime(x, t, tc);
      l.positionY!.setTargetAtTime(y, t, tc);
      l.positionZ!.setTargetAtTime(z, t, tc);
    } else {
      l.setPosition?.(x, y, z);
    }
  }

  private applyOrientation(): void {
    const l = this.nativeListener;
    const [fx, fy, fz] = this.forwardVec;
    const [ux, uy, uz] = this.upVec;
    if (this.supportsModernAPI) {
      const t = this.context.currentTime;
      const tc = this.smoothingTime;
      l.forwardX!.setTargetAtTime(fx, t, tc);
      l.forwardY!.setTargetAtTime(fy, t, tc);
      l.forwardZ!.setTargetAtTime(fz, t, tc);
      l.upX!.setTargetAtTime(ux, t, tc);
      l.upY!.setTargetAtTime(uy, t, tc);
      l.upZ!.setTargetAtTime(uz, t, tc);
    } else {
      l.setOrientation?.(fx, fy, fz, ux, uy, uz);
    }
  }

  private applyImmediate(): void {
    const l = this.nativeListener;
    const [x, y, z] = this.position;
    const [fx, fy, fz] = this.forwardVec;
    const [ux, uy, uz] = this.upVec;
    if (this.supportsModernAPI) {
      l.positionX!.value = x;
      l.positionY!.value = y;
      l.positionZ!.value = z;
      l.forwardX!.value = fx;
      l.forwardY!.value = fy;
      l.forwardZ!.value = fz;
      l.upX!.value = ux;
      l.upY!.value = uy;
      l.upZ!.value = uz;
    } else {
      l.setPosition?.(x, y, z);
      l.setOrientation?.(fx, fy, fz, ux, uy, uz);
    }
  }
}
