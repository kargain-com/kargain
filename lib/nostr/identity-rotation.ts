import { getNostrPool } from "@/lib/nostr/nostr-client";
import { loadCachedPubkey } from "@/lib/nostr/nostr-pubkey-cache";
import { attestedPubkeyForAddress } from "@/lib/nostr/resolve-attested-profile";

export function normalizePubkeyHex(pubkey: string): string {
  return pubkey.trim().toLowerCase();
}

/** True when derived and expected pubkeys differ (identity rotation detected). */
export function isRotatedIdentity(derivedPubkey: string, expectedPubkey: string): boolean {
  return normalizePubkeyHex(derivedPubkey) !== normalizePubkeyHex(expectedPubkey);
}

export type ResolveExpectedPubkeyDeps = {
  loadCachedPubkey: (address: `0x${string}`) => string | null;
  attestedPubkeyForAddress: (address: `0x${string}`) => Promise<string | null>;
};

/** Cached attested pubkey first, then one relay resolve. */
export async function resolveExpectedPubkey(
  address: `0x${string}`,
  deps?: Partial<ResolveExpectedPubkeyDeps>,
): Promise<string | null> {
  const loadCache = deps?.loadCachedPubkey ?? loadCachedPubkey;
  const cached = loadCache(address);
  if (cached?.trim()) return cached.trim();

  const resolveAttested =
    deps?.attestedPubkeyForAddress ??
    ((addr: `0x${string}`) => attestedPubkeyForAddress(addr, { pool: getNostrPool() }));
  return resolveAttested(address);
}

/** Gate helper for publishNostrProfile — block when expected pubkey exists and differs. */
export async function isProfilePublishBlockedByRotation(
  address: `0x${string}`,
  derivedPubkey: string,
  deps?: Partial<ResolveExpectedPubkeyDeps>,
): Promise<boolean> {
  const expected = await resolveExpectedPubkey(address, deps);
  if (!expected) return false;
  return isRotatedIdentity(derivedPubkey, expected);
}
