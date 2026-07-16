/**
 * Session-scoped observation memos. Only this module may touch localStorage
 * under lib/messaging/.
 */

export type CacheEntry = {
  intent?: boolean | null;
  networkRegistered?: boolean;
  buildClient?: boolean;
  readAtMs: number;
};

export type MessagingCachePort = {
  get(address: string): CacheEntry | undefined;
  set(address: string, patch: Partial<CacheEntry>): void;
  invalidate(address: string): void;
  invalidateAll(): void;
};

const DEFAULT_TTL_MS = 30 * 60 * 1000;

const LEGACY_KEY_PREFIXES = [
  "xmtp:opted-in:",
  "xmtp:disabled:",
  "xmtp:network-registered:",
] as const;

let legacyKeysPurged = false;

function purgeLegacyMessagingKeys(): void {
  if (!storageAvailable()) return;
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (LEGACY_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      keys.push(key);
    }
  }
  for (const key of keys) localStorage.removeItem(key);
}

function purgeLegacyMessagingKeysOnce(): void {
  if (legacyKeysPurged) return;
  legacyKeysPurged = true;
  purgeLegacyMessagingKeys();
}

function storageAvailable(): boolean {
  return typeof localStorage !== "undefined";
}

function cacheKey(address: string, env: string): string {
  return `messaging:memo:${env}:${address.toLowerCase()}`;
}

export function createMessagingCachePort(
  env: string,
  ttlMs: number = DEFAULT_TTL_MS,
): MessagingCachePort {
  purgeLegacyMessagingKeysOnce();
  function read(address: string): CacheEntry | undefined {
    if (!storageAvailable()) return undefined;
    const raw = localStorage.getItem(cacheKey(address, env));
    if (!raw) return undefined;
    try {
      const entry = JSON.parse(raw) as CacheEntry;
      if (Date.now() - entry.readAtMs > ttlMs) {
        localStorage.removeItem(cacheKey(address, env));
        return undefined;
      }
      return entry;
    } catch {
      return undefined;
    }
  }

  return {
    get: read,
    set(address, patch) {
      if (!storageAvailable()) return;
      const prev = read(address) ?? { readAtMs: Date.now() };
      const next: CacheEntry = { ...prev, ...patch, readAtMs: Date.now() };
      localStorage.setItem(cacheKey(address, env), JSON.stringify(next));
    },
    invalidate(address) {
      if (!storageAvailable()) return;
      localStorage.removeItem(cacheKey(address, env));
    },
    invalidateAll() {
      if (!storageAvailable()) return;
      const prefix = `messaging:memo:${env}:`;
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key?.startsWith(prefix)) keys.push(key);
      }
      for (const key of keys) localStorage.removeItem(key);
    },
  };
}

/** In-memory cache for tests and environments without localStorage. */
export function createInMemoryMessagingCache(): MessagingCachePort {
  const store = new Map<string, CacheEntry>();
  const key = (address: string) => address.toLowerCase();
  return {
    get(address) {
      return store.get(key(address));
    },
    set(address, patch) {
      const prev = store.get(key(address)) ?? { readAtMs: Date.now() };
      store.set(key(address), { ...prev, ...patch, readAtMs: Date.now() });
    },
    invalidate(address) {
      store.delete(key(address));
    },
    invalidateAll() {
      store.clear();
    },
  };
}
