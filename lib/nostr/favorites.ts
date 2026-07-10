"use client";

import {
  applyLwwAdd,
  applyLwwRemove,
  FAVORITES_POLICY,
  getDefaultNostrPool,
  lwwActiveTokenIds,
  mergeLwwElementSetEvents,
  mergeReadLwwState,
  pruneLwwTombstones,
  pubkeyFromPrivateKey,
  publishLwwElementSet,
  runSerializedPubkeyWrite,
  syncLwwStateToTokenIds,
  fetchAppEvents,
} from "@/lib/nostr/app-event-store";

export { FAVORITES_LIST_ID, PASSPORT_TAG_PREFIX } from "@/lib/nostr/app-event-store";

/** Load favorites list for a given public key from relays. Never throws. */
export async function loadFavorites(pubkey: string): Promise<string[]> {
  try {
    if (!pubkey.trim()) return [];
    const pool = getDefaultNostrPool();
    const events = await fetchAppEvents(pool, pubkey, FAVORITES_POLICY);
    const merged = mergeLwwElementSetEvents(events);
    const now = Math.floor(Date.now() / 1000);
    const pruned = pruneLwwTombstones(merged, now);
    return lwwActiveTokenIds(pruned);
  } catch {
    return [];
  }
}

/** Save an updated favorites list (bulk LWW sync). Never throws. */
export async function saveFavorites(tokenIds: string[], privateKey: string): Promise<void> {
  try {
    if (!privateKey.trim()) return;
    const pubkey = pubkeyFromPrivateKey(privateKey);
    await runSerializedPubkeyWrite(pubkey, async () => {
      const pool = getDefaultNostrPool();
      const base = await mergeReadLwwState(pool, pubkey, FAVORITES_POLICY);
      const now = Math.floor(Date.now() / 1000);
      const next = syncLwwStateToTokenIds(base, tokenIds, now);
      await publishLwwElementSet(pool, privateKey, FAVORITES_POLICY, next);
    });
  } catch {
    // migration path swallows errors
  }
}

/** Add one token ID to the favorites list. Fail-closed when merge-base query throws. */
export async function addFavorite(tokenId: string, privateKey: string): Promise<boolean> {
  if (!tokenId || !privateKey.trim()) return false;
  const pubkey = pubkeyFromPrivateKey(privateKey);

  return runSerializedPubkeyWrite(pubkey, async () => {
    try {
      const pool = getDefaultNostrPool();
      const base = await mergeReadLwwState(pool, pubkey, FAVORITES_POLICY);
      const active = lwwActiveTokenIds(base);
      if (active.includes(tokenId)) return true;

      const now = Math.floor(Date.now() / 1000);
      const next = applyLwwAdd(base, tokenId, now);
      return publishLwwElementSet(pool, privateKey, FAVORITES_POLICY, next);
    } catch {
      return false;
    }
  });
}

/** Remove one token ID from the favorites list. Fail-closed when merge-base query throws. */
export async function removeFavorite(tokenId: string, privateKey: string): Promise<boolean> {
  if (!tokenId || !privateKey.trim()) return false;
  const pubkey = pubkeyFromPrivateKey(privateKey);

  return runSerializedPubkeyWrite(pubkey, async () => {
    try {
      const pool = getDefaultNostrPool();
      const base = await mergeReadLwwState(pool, pubkey, FAVORITES_POLICY);
      const active = lwwActiveTokenIds(base);
      if (!active.includes(tokenId)) return true;

      const now = Math.floor(Date.now() / 1000);
      const next = applyLwwRemove(base, tokenId, now);
      return publishLwwElementSet(pool, privateKey, FAVORITES_POLICY, next);
    } catch {
      return false;
    }
  });
}
