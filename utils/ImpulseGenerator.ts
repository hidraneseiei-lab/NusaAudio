/**
 * NusaAudio3D — ImpulseGenerator
 *
 * Procedurally synthesizes convolution-reverb impulse responses so
 * `ReverbZone` never needs a shipped `.wav` asset. Every IR is built from
 * band-limited, decay-shaped, per-channel-decorrelated noise so it sounds
 * dense and smooth instead of harsh or metallic:
 *
 *  1. Independent noise seeds per channel → wide, natural stereo image.
 *  2. A soft "density" ramp during the first milliseconds (simulates early
 *     reflections building up) instead of an abrupt noise-burst click.
 *  3. A perceptually-tuned power-curve decay envelope (character dependent).
 *  4. One-pole low-pass "coloring" per character so tails feel like real
 *     rooms (which absorb high frequencies over distance) instead of
 *     full-bandwidth static.
 *  5. Peak normalization so different presets stay level-matched.
 */
import type { ImpulseGeneratorOptions, ReverbCharacter } from "../types";

interface CharacterProfile {
  duration: number;
  decay: number;
  /** 0..1, how much high frequency content survives the tail (higher = brighter). */
  brightness: number;
  /** milliseconds of early-reflection build-up before the tail is fully dense. */
  density: number;
}

const CHARACTER_PROFILES: Record<ReverbCharacter, CharacterProfile> = {
  room: { duration: 1.1, decay: 3.6, brightness: 0.55, density: 8 },
  hall: { duration: 2.6, decay: 2.2, brightness: 0.7, density: 25 },
  plate: { duration: 1.8, decay: 2.6, brightness: 0.92, density: 4 },
  cathedral: { duration: 4.8, decay: 1.5, brightness: 0.5, density: 45 },
  cave: { duration: 3.4, decay: 1.8, brightness: 0.35, density: 60 },
  custom: { duration: 2, decay: 2.5, brightness: 0.65, density: 15 },
};

/** Simple, fast one-pole low-pass used to "color" noise per-channel. */
function onePoleLowPass(samples: Float32Array, cutoffAlpha: number): void {
  let previous = 0;
  for (let i = 0; i < samples.length; i++) {
    previous = previous + cutoffAlpha * (samples[i] - previous);
    samples[i] = previous;
  }
}

export class ImpulseGenerator {
  /**
   * Generates a stereo (or mono/N-channel) `AudioBuffer` suitable for
   * `ConvolverNode.buffer`, entirely in-memory — no network requests.
   */
  static generate(context: BaseAudioContext, options: ImpulseGeneratorOptions = {}): AudioBuffer {
    const character = options.character ?? "hall";
    const profile = CHARACTER_PROFILES[character] ?? CHARACTER_PROFILES.hall;

    const duration = Math.max(0.05, options.duration ?? profile.duration);
    const decay = Math.max(0.1, options.decay ?? profile.decay);
    const preDelay = Math.max(0, options.preDelay ?? 0);
    const channels = Math.max(1, options.channels ?? 2);
    const reverse = options.reverse ?? false;

    const sampleRate = context.sampleRate;
    const preDelaySamples = Math.floor(preDelay * sampleRate);
    const tailSamples = Math.max(1, Math.floor(duration * sampleRate));
    const totalSamples = preDelaySamples + tailSamples;

    const buffer = context.createBuffer(channels, totalSamples, sampleRate);
    const densitySamples = Math.max(1, Math.floor((profile.density / 1000) * sampleRate));

    // One-pole alpha derived from brightness: brighter => higher cutoff => larger alpha.
    const lowPassAlpha = 0.05 + profile.brightness * 0.9;

    for (let ch = 0; ch < channels; ch++) {
      const data = buffer.getChannelData(ch);
      const noise = new Float32Array(tailSamples);

      for (let i = 0; i < tailSamples; i++) {
        // Independent random stream per channel => natural stereo decorrelation.
        noise[i] = Math.random() * 2 - 1;
      }

      // Color the noise so the tail isn't full-bandwidth hiss.
      onePoleLowPass(noise, lowPassAlpha);

      for (let i = 0; i < tailSamples; i++) {
        const t = i / tailSamples;

        // Perceptual power-curve decay envelope (smooth, no discontinuities).
        const envelope = Math.pow(1 - t, decay);

        // Early-reflection build-up: fade IN from silence over `density` ms so
        // the very start of the IR never pops, then the natural decay takes over.
        const buildUp = densitySamples > 1 ? Math.min(1, i / densitySamples) : 1;

        data[preDelaySamples + i] = noise[i] * envelope * buildUp;
      }

      if (reverse) {
        data.reverse();
      }
    }

    // Peak-normalize across all channels so different presets / durations
    // stay comparably loud once mixed through a ConvolverNode.
    let peak = 0;
    for (let ch = 0; ch < channels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < data.length; i++) {
        const abs = Math.abs(data[i]);
        if (abs > peak) peak = abs;
      }
    }
    if (peak > 0) {
      const target = 0.92;
      const scale = target / peak;
      for (let ch = 0; ch < channels; ch++) {
        const data = buffer.getChannelData(ch);
        for (let i = 0; i < data.length; i++) data[i] *= scale;
      }
    }

    return buffer;
  }
}
