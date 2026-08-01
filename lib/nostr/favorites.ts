"use client";

import {
  applyLwwAdd,
  applyLwwRemove,
  FAVORITES_POLICY,
  getDefaultNostrPool,
  lwwActiveTokenIds,
  mergeReadLwwState,
  pubkeyFromPrivateKey,
  publishLwwElementSet,
  runSerializedPubkeyWrite,
  syncLwwStateToTokenIds,
} from "@/lib/nostr/app-event-store";

export { FAVORITES_LIST_ID, PASSPORT_TAG_PREFIX } from "@/lib/nostr/app-event-store";

/** Load favorites list for a given public key from relays. Never throws. */
export async function loadFavorites(pubkey: string): Promise<string[]> {
  try {
    if (!pubkey.trim()) return [];
    const pool = getDefaultNostrPool();
    const base = await mergeReadLwwState(pool, pubkey, FAVORITES_POLICY);
    if (base.status === "unanswered") return [];
    return lwwActiveTokenIds(base.state);
  } catch {
    return [];
  }
}

/** Save an updated favorites list (bulk LWW sync). Never throws. Skips when no relay answered. */
export async function saveFavorites(tokenIds: string[], privateKey: string): Promise<void> {
  try {
    if (!privateKey.trim()) return;
    const pubkey = pubkeyFromPrivateKey(privateKey);
    await runSerializedPubkeyWrite(pubkey, async () => {
      const pool = getDefaultNostrPool();
      const base = await mergeReadLwwState(pool, pubkey, FAVORITES_POLICY);
      if (base.status === "unanswered") return;
      const now = Math.floor(Date.now() / 1000);
      const next = syncLwwStateToTokenIds(base.state, tokenIds, now);
      await publishLwwElementSet(
        pool,
        privateKey,
        FAVORITES_POLICY,
        next,
        base.answeredRelays,
      );
    });
  } catch {
    // migration path swallows errors
  }
}

/**
 * Add one token ID to the favorites list.
 * Fail-closed when no relay answered the merge-base read (never gates on empty content).
 */
export async function addFavorite(tokenId: string, privateKey: string): Promise<boolean> {
  if (!tokenId || !privateKey.trim()) return false;
  const pubkey = pubkeyFromPrivateKey(privateKey);

  return runSerializedPubkeyWrite(pubkey, async () => {
    try {
      const pool = getDefaultNostrPool();
      const base = await mergeReadLwwState(pool, pubkey, FAVORITES_POLICY);
      if (base.status === "unanswered") return false;

      const active = lwwActiveTokenIds(base.state);
      if (active.includes(tokenId)) return true;

      const now = Math.floor(Date.now() / 1000);
      const next = applyLwwAdd(base.state, tokenId, now);
      return publishLwwElementSet(
        pool,
        privateKey,
        FAVORITES_POLICY,
        next,
        base.answeredRelays,
      );
    } catch {
      return false;
    }
  });
}

/**
 * Remove one token ID from the favorites list.
 * Fail-closed when no relay answered the merge-base read (never gates on empty content).
 */
export async function removeFavorite(tokenId: string, privateKey: string): Promise<boolean> {
  if (!tokenId || !privateKey.trim()) return false;
  const pubkey = pubkeyFromPrivateKey(privateKey);

  return runSerializedPubkeyWrite(pubkey, async () => {
    try {
      const pool = getDefaultNostrPool();
      const base = await mergeReadLwwState(pool, pubkey, FAVORITES_POLICY);
      if (base.status === "unanswered") return false;

      const active = lwwActiveTokenIds(base.state);
      if (!active.includes(tokenId)) return true;

      const now = Math.floor(Date.now() / 1000);
      const next = applyLwwRemove(base.state, tokenId, now);
      return publishLwwElementSet(
        pool,
        privateKey,
        FAVORITES_POLICY,
        next,
        base.answeredRelays,
      );
    } catch {
      return false;
    }
  });
}
