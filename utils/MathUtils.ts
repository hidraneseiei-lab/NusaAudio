/**
 * NusaAudio3D — MathUtils
 *
 * Small, dependency-free math helpers shared across the engine. Keeping them
 * in one place means every module smooths/attenuates/converts numbers in a
 * perfectly consistent (and easily testable) way.
 */
import type { Vector3 } from "../types";

/** Clamps `value` into the inclusive `[min, max]` range. */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Linear interpolation between `a` and `b` by factor `t` (0..1, unclamped). */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Frame-rate independent exponential smoothing ("damping").
 * Moves `current` towards `target` such that ~63% of the distance is
 * covered every `1/lambda` seconds, regardless of `dt`. This is the same
 * family of smoothing used by `AudioParam.setTargetAtTime`, applied here
 * for plain JS numbers (e.g. manual listener velocity, occlusion factor).
 */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  if (lambda <= 0 || dt <= 0) return target;
  const t = 1 - Math.exp(-lambda * dt);
  return lerp(current, target, clamp(t, 0, 1));
}

/** Converts decibels to a linear gain multiplier. */
export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/** Converts a linear gain multiplier to decibels. Silence maps to -Infinity. */
export function gainToDb(gain: number): number {
  return gain <= 0 ? -Infinity : 20 * Math.log10(gain);
}

/** Smoothstep interpolation, useful for natural-feeling falloffs (0..1 in, 0..1 out). */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Returns a pseudo-random float in `[min, max)`. */
export function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Small, self-contained 3D vector helpers operating on `[x, y, z]` tuples. */
export const vec3 = {
  zero(): Vector3 {
    return [0, 0, 0];
  },
  clone(v: Vector3): Vector3 {
    return [v[0], v[1], v[2]];
  },
  add(a: Vector3, b: Vector3): Vector3 {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  },
  sub(a: Vector3, b: Vector3): Vector3 {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  },
  scale(a: Vector3, s: number): Vector3 {
    return [a[0] * s, a[1] * s, a[2] * s];
  },
  dot(a: Vector3, b: Vector3): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  },
  length(a: Vector3): number {
    return Math.sqrt(vec3.dot(a, a));
  },
  distance(a: Vector3, b: Vector3): number {
    return vec3.length(vec3.sub(a, b));
  },
  normalize(a: Vector3): Vector3 {
    const len = vec3.length(a);
    if (len < 1e-8) return [0, 0, 0];
    return vec3.scale(a, 1 / len);
  },
  lerp(a: Vector3, b: Vector3, t: number): Vector3 {
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  },
  damp(current: Vector3, target: Vector3, lambda: number, dt: number): Vector3 {
    return [
      damp(current[0], target[0], lambda, dt),
      damp(current[1], target[1], lambda, dt),
      damp(current[2], target[2], lambda, dt),
    ];
  },
  equals(a: Vector3, b: Vector3, epsilon = 1e-6): boolean {
    return Math.abs(a[0] - b[0]) < epsilon && Math.abs(a[1] - b[1]) < epsilon && Math.abs(a[2] - b[2]) < epsilon;
  },
};
