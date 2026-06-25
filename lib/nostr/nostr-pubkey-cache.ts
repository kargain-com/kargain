"use client";

const PUBKEY_CACHE_PREFIX = "kargain_nostr_pubkey_v1:";

function cacheKey(address: `0x${string}`): string {
  return `${PUBKEY_CACHE_PREFIX}${address.toLowerCase()}`;
}

function requireBrowser(): boolean {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

/** Load cached Nostr pubkey for a wallet (public metadata only). */
export function loadCachedPubkey(address: `0x${string}`): string | null {
  if (!requireBrowser()) return null;
  const raw = window.localStorage.getItem(cacheKey(address));
  return raw?.trim() ? raw.trim() : null;
}

/** Persist Nostr pubkey after first successful key link. */
export function saveCachedPubkey(address: `0x${string}`, pubkey: string): void {
  if (!requireBrowser() || !pubkey.trim()) return;
  window.localStorage.setItem(cacheKey(address), pubkey.trim());
}

export function clearCachedPubkey(address: `0x${string}`): void {
  if (!requireBrowser()) return;
  window.localStorage.removeItem(cacheKey(address));
}
