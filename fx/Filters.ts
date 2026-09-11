/**
 * NusaAudio3D — Filters
 *
 * Small factory functions for the audio-graph nodes reused everywhere in
 * the engine. Centralising node creation keeps every voice / bus / master
 * chain configured with the exact same "sounds smooth & clean" defaults.
 */
import {
  CLEAR_CUTOFF_HZ,
  DC_BLOCKER_HZ,
  MASTER_LIMITER_ATTACK,
  MASTER_LIMITER_KNEE_DB,
  MASTER_LIMITER_RATIO,
  MASTER_LIMITER_RELEASE,
  MASTER_LIMITER_THRESHOLD_DB,
} from "../constants";

/**
 * A steep, sub-audible high-pass filter that removes DC offset and
 * infrasonic rumble which would otherwise eat into the limiter's headroom
 * and cause pumping. Completely inaudible, purely "cleans up" the signal.
 */
export function createDCBlocker(context: BaseAudioContext): BiquadFilterNode {
  const filter = context.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = DC_BLOCKER_HZ;
  filter.Q.value = 0.707; // Butterworth response: flat passband, no resonant bump.
  return filter;
}

/**
 * A transparent brick-wall limiter built from the native `DynamicsCompressorNode`.
 * Tuned for a fast-but-clickless attack and a musical release so peaks are
 * caught before they clip, without audibly "pumping" the mix.
 */
export function createMasterLimiter(context: BaseAudioContext): DynamicsCompressorNode {
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = MASTER_LIMITER_THRESHOLD_DB;
  limiter.knee.value = MASTER_LIMITER_KNEE_DB;
  limiter.ratio.value = MASTER_LIMITER_RATIO;
  limiter.attack.value = MASTER_LIMITER_ATTACK;
  limiter.release.value = MASTER_LIMITER_RELEASE;
  return limiter;
}

/**
 * A very gentle tanh-based saturator ("warmth"). Used sparingly (and only
 * when explicitly enabled) to add analog-style "glue" to the master bus —
 * rounds off the sharpest digital peaks for a smoother, less fatiguing tone
 * without meaningfully coloring the signal.
 */
export function createWarmthSaturator(context: BaseAudioContext, amount = 0.15): WaveShaperNode {
  const shaper = context.createWaveShaper();
  const samples = 1024;
  const curve = new Float32Array(samples);
  const k = Math.max(0.0001, amount) * 6; // drive amount
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1;
    // Soft tanh saturation, normalized so unity input stays near unity output.
    curve[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  shaper.curve = curve;
  shaper.oversample = "4x";
  return shaper;
}

/**
 * Occlusion low-pass: attenuates high frequencies to simulate sound passing
 * through/around geometry. Starts fully open (inaudible) at `CLEAR_CUTOFF_HZ`.
 */
export function createOcclusionFilter(context: BaseAudioContext): BiquadFilterNode {
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = CLEAR_CUTOFF_HZ;
  filter.Q.value = 0.5; // Slightly damped, avoids resonant "telephone" artefacts.
  return filter;
}

/**
 * Air-absorption high-shelf: gently rolls off highs the further away a
 * sound is, mimicking how real air scatters high frequencies over distance.
 * This alone makes distant sounds feel noticeably smoother/"further away"
 * instead of just quieter.
 */
export function createAirAbsorptionFilter(context: BaseAudioContext): BiquadFilterNode {
  const filter = context.createBiquadFilter();
  filter.type = "highshelf";
  filter.frequency.value = CLEAR_CUTOFF_HZ;
  filter.gain.value = 0;
  return filter;
}

/** Creates a stereo `ConvolverNode` pre-configured for reverb sends (non-normalized: we normalize IRs ourselves). */
export function createConvolver(context: BaseAudioContext, buffer: AudioBuffer): ConvolverNode {
  const convolver = context.createConvolver();
  convolver.normalize = false;
  convolver.buffer = buffer;
  return convolver;
}

/** Utility: ramps an AudioParam to `value` smoothly (click-free) using an exponential glide. */
export function glideParam(param: AudioParam, value: number, context: BaseAudioContext, timeConstant: number): void {
  param.setTargetAtTime(value, context.currentTime, Math.max(0.001, timeConstant));
}

/** Utility: linearly ramps an AudioParam to `value` over `duration` seconds (click-free, deterministic end time). */
export function rampParam(param: AudioParam, value: number, context: BaseAudioContext, duration: number): void {
  const now = context.currentTime;
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  if (duration <= 0) {
    param.setValueAtTime(value, now);
  } else {
    param.linearRampToValueAtTime(value, now + duration);
  }
}
