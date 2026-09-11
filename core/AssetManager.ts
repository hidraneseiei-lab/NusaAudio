/**
 * NusaAudio3D — AssetManager
 *
 * Cached, concurrency-limited loading & decoding of audio buffers. Ensures
 * the same URL is never fetched/decoded twice, and that flooding `loadBatch`
 * with hundreds of URLs doesn't open hundreds of simultaneous connections.
 */
import { EventEmitter } from "../utils/EventEmitter";

export interface AssetManagerOptions {
  /** Maximum simultaneous fetch+decode operations. Defaults to 6. */
  maxConcurrent?: number;
}

export interface BatchItem {
  id: string;
  url: string;
}

interface AssetManagerEvents {
  progress: [{ loaded: number; total: number; id: string }];
  [key: string]: unknown[];
}

export class AssetManager extends EventEmitter<AssetManagerEvents> {
  private readonly context: BaseAudioContext;
  private readonly maxConcurrent: number;
  private readonly cache = new Map<string, AudioBuffer>();
  private readonly pending = new Map<string, Promise<AudioBuffer>>();
  private activeCount = 0;
  private readonly queue: Array<() => void> = [];

  constructor(context: BaseAudioContext, options: AssetManagerOptions = {}) {
    super();
    this.context = context;
    this.maxConcurrent = Math.max(1, options.maxConcurrent ?? 6);
  }

  /** True if `id` is already decoded and cached. */
  has(id: string): boolean {
    return this.cache.has(id);
  }

  /** Returns the cached buffer for `id`, or `undefined` if not loaded. */
  get(id: string): AudioBuffer | undefined {
    return this.cache.get(id);
  }

  /**
   * Loads & decodes an audio file, caching the result under `id`.
   * Concurrent calls for the same `id` share a single in-flight promise.
   */
  async load(id: string, url: string): Promise<AudioBuffer> {
    const cached = this.cache.get(id);
    if (cached) return cached;

    const inFlight = this.pending.get(id);
    if (inFlight) return inFlight;

    const promise = this.runThrottled(async () => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`NusaAudio3D: failed to fetch "${url}" (${response.status} ${response.statusText})`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const buffer = await this.decode(arrayBuffer);
      this.cache.set(id, buffer);
      return buffer;
    });

    this.pending.set(id, promise);
    try {
      return await promise;
    } finally {
      this.pending.delete(id);
    }
  }

  /** Decodes a raw `ArrayBuffer` without caching (useful for programmatically fetched data). */
  decode(arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
    // `decodeAudioData` has both a promise-based and legacy callback-based
    // signature across browsers; the promise form is used here and is
    // universally supported by evergreen browsers.
    return this.context.decodeAudioData(arrayBuffer.slice(0));
  }

  /** Loads many assets, resolving once every one has settled (never rejects on individual failures). */
  async loadBatch(items: BatchItem[]): Promise<Map<string, AudioBuffer | Error>> {
    const results = new Map<string, AudioBuffer | Error>();
    let loaded = 0;
    await Promise.all(
      items.map(async (item) => {
        try {
          const buffer = await this.load(item.id, item.url);
          results.set(item.id, buffer);
        } catch (error) {
          results.set(item.id, error instanceof Error ? error : new Error(String(error)));
        } finally {
          loaded += 1;
          this.emit("progress", { loaded, total: items.length, id: item.id });
        }
      }),
    );
    return results;
  }

  /** Registers a pre-decoded buffer directly (e.g. one built with `ImpulseGenerator` or an offline render). */
  register(id: string, buffer: AudioBuffer): void {
    this.cache.set(id, buffer);
  }

  /** Frees a cached buffer so it can be garbage-collected. */
  unload(id: string): void {
    this.cache.delete(id);
  }

  /** Clears the entire cache. */
  clear(): void {
    this.cache.clear();
  }

  private runThrottled<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        this.activeCount += 1;
        task()
          .then(resolve, reject)
          .finally(() => {
            this.activeCount -= 1;
            const next = this.queue.shift();
            if (next) next();
          });
      };
      if (this.activeCount < this.maxConcurrent) run();
      else this.queue.push(run);
    });
  }
}
