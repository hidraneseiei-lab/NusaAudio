/**
 * NusaAudio3D — EventEmitter
 *
 * A tiny, dependency-free, strongly-typed event emitter used as the base
 * class for every engine object that needs to notify the outside world
 * (sound started/stopped, voice stolen, zone entered, etc.).
 */
export type EventMap = Record<string, unknown[]>;
export type Listener<Args extends unknown[]> = (...args: Args) => void;

type AnyListener = (...args: unknown[]) => void;

export class EventEmitter<TEvents extends EventMap = Record<string, unknown[]>> {
  private listeners = new Map<keyof TEvents, Set<AnyListener>>();

  /** Registers `handler` for `event`. Returns an unsubscribe function. */
  on<K extends keyof TEvents>(event: K, handler: Listener<TEvents[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler as unknown as AnyListener);
    return () => this.off(event, handler);
  }

  /** Registers `handler` for `event`, automatically removed after the first call. */
  once<K extends keyof TEvents>(event: K, handler: Listener<TEvents[K]>): () => void {
    const off = this.on(event, ((...args: TEvents[K]) => {
      off();
      handler(...args);
    }) as Listener<TEvents[K]>);
    return off;
  }

  /** Removes a previously registered `handler` for `event`. */
  off<K extends keyof TEvents>(event: K, handler: Listener<TEvents[K]>): void {
    this.listeners.get(event)?.delete(handler as unknown as AnyListener);
  }

  /** Synchronously invokes every listener registered for `event`. */
  emit<K extends keyof TEvents>(event: K, ...args: TEvents[K]): void {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return;
    // Copy to array first: a handler unsubscribing during emit must not
    // corrupt iteration (classic Set-mutation-during-iteration bug).
    for (const handler of Array.from(set)) {
      handler(...(args as unknown[]));
    }
  }

  /** Removes every listener, optionally scoped to a single `event`. */
  removeAllListeners<K extends keyof TEvents>(event?: K): void {
    if (event) this.listeners.delete(event);
    else this.listeners.clear();
  }
}
