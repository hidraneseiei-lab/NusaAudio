/**
 * NusaAudio3D — OcclusionSystem
 *
 * You bring the raycast (physics engine, navmesh, BVH — whatever your game
 * uses), NusaAudio3D brings the budgeting + smoothing so that:
 *  - Only a handful of raycasts run per `update()` call, no matter how many
 *    sounds exist (`maxRaysPerFrame`, round-robin across active sounds).
 *  - The resulting muffling always fades in/out smoothly (`Sound3D` damps
 *    the raw 0..1 result internally), so occlusion never "pops".
 */
import { DEFAULT_MAX_OCCLUSION_RAYS_PER_FRAME } from "../constants";
import type { Vector3 } from "../types";
import type { Sound3D } from "../core/Sound3D";
import type { Listener3D } from "../core/Listener";

/**
 * Returns how occluded the path from `from` to `to` is: `0` = fully clear,
 * `1` = fully blocked. Intermediate values are supported (partial occlusion
 * through thin/soft geometry). `sound` is provided for per-material logic.
 */
export type OcclusionRaycaster = (from: Vector3, to: Vector3, sound: Sound3D) => number;

export class OcclusionSystem {
  maxRaysPerFrame: number = DEFAULT_MAX_OCCLUSION_RAYS_PER_FRAME;
  private raycaster: OcclusionRaycaster | null = null;
  private cursor = 0;

  setRaycaster(fn: OcclusionRaycaster | null): void {
    this.raycaster = fn;
  }

  hasRaycaster(): boolean {
    return this.raycaster !== null;
  }

  /**
   * Runs up to `maxRaysPerFrame` occlusion queries across `sounds`
   * (round-robin, so every sound eventually gets refreshed even with
   * hundreds of emitters) and feeds results back into each `Sound3D`.
   */
  update(sounds: Sound3D[], listener: Listener3D, dt: number): void {
    if (!this.raycaster || sounds.length === 0) return;

    const listenerPos = listener.getPosition();
    const budget = Math.min(this.maxRaysPerFrame, sounds.length);

    for (let i = 0; i < budget; i++) {
      const index = (this.cursor + i) % sounds.length;
      const sound = sounds[index];
      if (!sound.occlusionEnabled || !sound.isPlaying()) continue;
      const factor = clampFactor(this.raycaster(listenerPos, sound.getPosition(), sound));
      sound.applyOcclusionFactor(factor, dt * budget);
    }

    this.cursor = (this.cursor + budget) % Math.max(1, sounds.length);
  }
}

function clampFactor(value: number): number {
  if (Number.isNaN(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
