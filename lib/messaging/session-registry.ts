/**
 * Pure refcounted messaging-session registry — no React, no SDK.
 * release schedules destroy on one macrotask; a same-tick acquire cancels it.
 */

export type SessionRegistryClock = {
  /** Schedule destroy; return a cancel handle. Default: setTimeout(0). */
  scheduleDestroy(fn: () => void): { cancel(): void };
};

const defaultClock: SessionRegistryClock = {
  scheduleDestroy(fn) {
    const id = setTimeout(fn, 0);
    return { cancel: () => clearTimeout(id) };
  },
};

export type SessionRegistry<T extends { dispose(): void }> = {
  acquire(address: string, create: () => T): T;
  release(address: string): void;
  get(address: string): T | null;
  /** Test hook — current refcount, or 0 when absent. */
  refCount(address: string): number;
  /** Test hook — true while destroy is scheduled and not yet run. */
  pendingDestroy(address: string): boolean;
};

type InternalEntry<T> = {
  session: T;
  refCount: number;
  pending: { cancel(): void } | null;
};

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

export function createSessionRegistry<T extends { dispose(): void }>(
  clock: SessionRegistryClock = defaultClock,
): SessionRegistry<T> {
  const entries = new Map<string, InternalEntry<T>>();

  function destroyNow(key: string, entry: InternalEntry<T>): void {
    entry.pending = null;
    if (entry.refCount > 0) return;
    if (entries.get(key) !== entry) return;
    entries.delete(key);
    entry.session.dispose();
  }

  return {
    acquire(address, create) {
      const key = normalizeAddress(address);
      const existing = entries.get(key);
      if (existing) {
        if (existing.pending) {
          existing.pending.cancel();
          existing.pending = null;
        }
        existing.refCount += 1;
        return existing.session;
      }
      const session = create();
      entries.set(key, { session, refCount: 1, pending: null });
      return session;
    },

    release(address) {
      const key = normalizeAddress(address);
      const entry = entries.get(key);
      if (!entry) return;
      entry.refCount = Math.max(0, entry.refCount - 1);
      if (entry.refCount > 0) return;
      if (entry.pending) return;
      entry.pending = clock.scheduleDestroy(() => {
        destroyNow(key, entry);
      });
    },

    get(address) {
      const entry = entries.get(normalizeAddress(address));
      return entry?.session ?? null;
    },

    refCount(address) {
      return entries.get(normalizeAddress(address))?.refCount ?? 0;
    },

    pendingDestroy(address) {
      return entries.get(normalizeAddress(address))?.pending != null;
    },
  };
}
