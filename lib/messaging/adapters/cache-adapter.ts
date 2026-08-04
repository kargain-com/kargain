/**
 * Session-scoped observation memos and ephemeral messaging storage.
 * Only this module may touch localStorage / sessionStorage under lib/messaging/.
 */

export type CacheEntry = {
  intent?: boolean | null;
  readAtMs: number;
};

/** True when the browser storage global exists (feature detection, not data access). */
export function isMessagingStorageAvailable(): boolean {
  return typeof localStorage !== "undefined";
}

/**
 * TTL for session observation memos (intent latency only — never a CTA gate).
 * Smaller: more repeated intent reads after navigation. Larger: staler memo
 * after an external intent change until expiry or invalidate.
 */
export const MESSAGING_MEMO_TTL_MS = 30 * 60 * 1000;

/** Dedicated key — not subject to memo TTL (full-revoke cooldown must survive). */
function revokeAllKey(env: string, address: string): string {
  return `messaging:revoke-all:${env}:${address.toLowerCase()}`;
}

const memoryRevokeAllAt = new Map<string, number>();

/** Last successful full-account revoke timestamp (ms), if any. */
export function readLastRevokeAllAt(env: string, address: string): number | undefined {
  const key = revokeAllKey(env, address);
  if (isMessagingStorageAvailable()) {
    const raw = localStorage.getItem(key);
    if (!raw) return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return memoryRevokeAllAt.get(key);
}

/** Record a successful full-account revoke for cooldown enforcement. */
export function markRevokeAllAt(env: string, address: string, atMs: number): void {
  const key = revokeAllKey(env, address);
  if (isMessagingStorageAvailable()) {
    localStorage.setItem(key, String(atMs));
    return;
  }
  memoryRevokeAllAt.set(key, atMs);
}

/** Test helper — clear cooldown marker. */
export function clearRevokeAllAt(env: string, address: string): void {
  const key = revokeAllKey(env, address);
  if (isMessagingStorageAvailable()) localStorage.removeItem(key);
  memoryRevokeAllAt.delete(key);
}

/** Durable pending read-receipt conversation ids (survive reload). */
function pendingReceiptsKey(env: string, address: string): string {
  return `messaging:pending-receipts:${env}:${address.toLowerCase()}`;
}

const memoryPendingReceipts = new Map<string, string[]>();

export function readPendingReceipts(env: string, address: string): string[] {
  const key = pendingReceiptsKey(env, address);
  if (isMessagingStorageAvailable()) {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((id): id is string => typeof id === "string");
    } catch {
      return [];
    }
  }
  return [...(memoryPendingReceipts.get(key) ?? [])];
}

export function writePendingReceipts(
  env: string,
  address: string,
  conversationIds: Iterable<string>,
): void {
  const key = pendingReceiptsKey(env, address);
  const unique = [...new Set(conversationIds)];
  if (isMessagingStorageAvailable()) {
    if (unique.length === 0) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify(unique));
    return;
  }
  if (unique.length === 0) {
    memoryPendingReceipts.delete(key);
    return;
  }
  memoryPendingReceipts.set(key, unique);
}

/** Test helper — clear pending receipts for an address. */
export function clearPendingReceipts(env: string, address: string): void {
  writePendingReceipts(env, address, []);
}

/** Tab-scoped compose drafts (die with the tab). */
function composeDraftKey(conversationId: string): string {
  return `messaging:compose-draft:${conversationId}`;
}

const memoryComposeDrafts = new Map<string, string>();

function isMessagingSessionStorageAvailable(): boolean {
  return typeof sessionStorage !== "undefined";
}

/** Stage a composer draft until the thread peeks and clears storage after commit. */
export function writeComposeDraft(conversationId: string, text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  const key = composeDraftKey(conversationId);
  if (isMessagingSessionStorageAvailable()) {
    try {
      sessionStorage.setItem(key, trimmed);
    } catch {
      // Private mode / quota — draft is best-effort.
    }
    return;
  }
  memoryComposeDrafts.set(key, trimmed);
}

/** Pure read — does not mutate storage. */
export function peekStoredComposeDraft(conversationId: string): string | null {
  const key = composeDraftKey(conversationId);
  if (isMessagingSessionStorageAvailable()) {
    try {
      const trimmed = sessionStorage.getItem(key)?.trim() ?? "";
      return trimmed.length > 0 ? trimmed : null;
    } catch {
      return null;
    }
  }
  const trimmed = memoryComposeDrafts.get(key)?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

/** Remove a staged draft from browser/memory storage. */
export function clearStoredComposeDraft(conversationId: string): void {
  const key = composeDraftKey(conversationId);
  if (isMessagingSessionStorageAvailable()) {
    try {
      sessionStorage.removeItem(key);
    } catch {
      // ignore
    }
  }
  memoryComposeDrafts.delete(key);
}

/**
 * @deprecated Prefer peek + clear after commit. Kept for tests that need atomic consume.
 */
export function takeStoredComposeDraft(conversationId: string): string | null {
  const value = peekStoredComposeDraft(conversationId);
  clearStoredComposeDraft(conversationId);
  return value;
}

/** Test helper — clear all in-memory compose drafts. */
export function clearComposeDraftsForTest(): void {
  memoryComposeDrafts.clear();
  if (!isMessagingSessionStorageAvailable()) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const k = sessionStorage.key(i);
      if (k?.startsWith("messaging:compose-draft:")) keys.push(k);
    }
    for (const k of keys) sessionStorage.removeItem(k);
  } catch {
    // ignore
  }
}

export type MessagingCachePort = {
  get(address: string): CacheEntry | undefined;
  set(address: string, patch: Partial<CacheEntry>): void;
  invalidate(address: string): void;
  invalidateAll(): void;
};

const LEGACY_KEY_PREFIXES = [
  "xmtp:opted-in:",
  "xmtp:disabled:",
  "xmtp:network-registered:",
  "xmtp:lastseen:",
] as const;

let legacyKeysPurged = false;

function purgeLegacyMessagingKeys(): void {
  if (!isMessagingStorageAvailable()) return;
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

/** Test helper — re-run legacy purge (idempotent remove). */
export function purgeLegacyMessagingKeysForTest(): void {
  purgeLegacyMessagingKeys();
}

/** Test helper — allow createMessagingCachePort to purge again. */
export function resetLegacyPurgeFlagForTest(): void {
  legacyKeysPurged = false;
}

function cacheKey(address: string, env: string): string {
  return `messaging:memo:${env}:${address.toLowerCase()}`;
}

export function createMessagingCachePort(
  env: string,
  ttlMs: number = MESSAGING_MEMO_TTL_MS,
): MessagingCachePort {
  purgeLegacyMessagingKeysOnce();
  function read(address: string): CacheEntry | undefined {
    if (!isMessagingStorageAvailable()) return undefined;
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
      if (!isMessagingStorageAvailable()) return;
      const prev = read(address) ?? { readAtMs: Date.now() };
      const next: CacheEntry = { ...prev, ...patch, readAtMs: Date.now() };
      localStorage.setItem(cacheKey(address, env), JSON.stringify(next));
    },
    invalidate(address) {
      if (!isMessagingStorageAvailable()) return;
      localStorage.removeItem(cacheKey(address, env));
    },
    invalidateAll() {
      if (!isMessagingStorageAvailable()) return;
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
