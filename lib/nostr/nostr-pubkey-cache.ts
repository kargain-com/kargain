"use client";

/**
 * Memoises a *verified* address→pubkey binding (self or peer).
 * Not a trust store: cold cache must produce the same outcome as warm, only slower.
 * Write only after attestation verification succeeds (or the local key is derived).
 *
 * Storage access goes through {@link browserLocalStorage} so Node tooling that
 * transitively typechecks this module does not require the DOM lib.
 */

const PUBKEY_CACHE_PREFIX = "kargain_nostr_pubkey_v1:";

export type CachedPubkeyBinding = {
  pubkey: string;
  /** `created_at` of the verifying event that established the pin (0 if key-derived only). */
  boundCreatedAt: number;
};

type BrowserLocalStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

function cacheKey(address: `0x${string}`): string {
  return `${PUBKEY_CACHE_PREFIX}${address.toLowerCase()}`;
}

function browserLocalStorage(): BrowserLocalStorage | null {
  const g = globalThis as typeof globalThis & {
    window?: { localStorage?: BrowserLocalStorage };
  };
  return g.window?.localStorage ?? null;
}

function parseBinding(raw: string): CachedPubkeyBinding | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (
        parsed != null &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        typeof (parsed as { pubkey?: unknown }).pubkey === "string" &&
        typeof (parsed as { boundCreatedAt?: unknown }).boundCreatedAt === "number"
      ) {
        const pubkey = (parsed as { pubkey: string }).pubkey.trim();
        const boundCreatedAt = (parsed as { boundCreatedAt: number }).boundCreatedAt;
        if (!pubkey) return null;
        return { pubkey, boundCreatedAt };
      }
    } catch {
      return null;
    }
    return null;
  }
  // Legacy plain-pubkey entries (pre-P5b).
  return { pubkey: trimmed, boundCreatedAt: 0 };
}

/** Load full binding, or null when absent / SSR. */
export function loadCachedPubkeyBinding(
  address: `0x${string}`,
): CachedPubkeyBinding | null {
  const storage = browserLocalStorage();
  if (!storage) return null;
  const raw = storage.getItem(cacheKey(address));
  if (raw == null) return null;
  return parseBinding(raw);
}

/** Load cached Nostr pubkey for a wallet (public metadata only). */
export function loadCachedPubkey(address: `0x${string}`): string | null {
  return loadCachedPubkeyBinding(address)?.pubkey ?? null;
}

/**
 * Persist a verified (or locally derived) pubkey binding.
 * `boundCreatedAt` defaults to now when the caller has no event (key unlock).
 */
export function saveCachedPubkey(
  address: `0x${string}`,
  pubkey: string,
  boundCreatedAt: number = Math.floor(Date.now() / 1000),
): void {
  const storage = browserLocalStorage();
  if (!storage || !pubkey.trim()) return;
  const binding: CachedPubkeyBinding = {
    pubkey: pubkey.trim(),
    boundCreatedAt: Number.isFinite(boundCreatedAt) ? boundCreatedAt : 0,
  };
  storage.setItem(cacheKey(address), JSON.stringify(binding));
}

export function clearCachedPubkey(address: `0x${string}`): void {
  const storage = browserLocalStorage();
  if (!storage) return;
  storage.removeItem(cacheKey(address));
}
