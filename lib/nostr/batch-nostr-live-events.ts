const DEFAULT_DEBOUNCE_MS = 120;

/**
 * Coalesce rapid Nostr `onevent` callbacks into a single flush (after initial EOSE batch).
 */
export function createDebouncedNostrEventBuffer<T>(flushBatch: (events: T[]) => void, debounceMs = DEFAULT_DEBOUNCE_MS) {
  let pending: T[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const scheduleFlush = () => {
    if (timer != null) return;
    timer = setTimeout(() => {
      timer = null;
      if (pending.length === 0) return;
      const batch = pending;
      pending = [];
      flushBatch(batch);
    }, debounceMs);
  };

  return {
    push(event: T) {
      pending.push(event);
      scheduleFlush();
    },
    flushNow() {
      if (timer != null) {
        clearTimeout(timer);
        timer = null;
      }
      if (pending.length === 0) return;
      const batch = pending;
      pending = [];
      flushBatch(batch);
    },
    clear() {
      if (timer != null) {
        clearTimeout(timer);
        timer = null;
      }
      pending = [];
    },
  };
}
