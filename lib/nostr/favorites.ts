"use client";

import { hexToBytes } from "viem";
import { finalizeEvent } from "nostr-tools";

import { getNostrPool, NOSTR_RELAYS, nostrPubkeyFromPrivateKey } from "@/lib/nostr/nostr-client";
import { publishSignedEvent } from "@/lib/nostr/publish-event";

const FAVORITES_LIST_ID = "kargain-favorites";
const PASSPORT_TAG_PREFIX = "kargain:passport:";

function parseTokenIdsFromEvent(tags: string[][]): string[] {
  const ids: string[] = [];
  for (const tag of tags) {
    if (tag[0] !== "i" || !tag[1]?.startsWith(PASSPORT_TAG_PREFIX)) continue;
    const tokenId = tag[1].slice(PASSPORT_TAG_PREFIX.length);
    if (tokenId) ids.push(tokenId);
  }
  return ids;
}

function toPrivateKeyBytes(privateKey: string): Uint8Array {
  const hex = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  return hexToBytes(hex as `0x${string}`);
}

/** Load favorites list for a given public key from relays. Never throws. */
export async function loadFavorites(pubkey: string): Promise<string[]> {
  try {
    if (!pubkey.trim()) return [];
    const pool = getNostrPool();
    const events = await pool.querySync(
      [...NOSTR_RELAYS],
      { kinds: [30000], authors: [pubkey], "#d": [FAVORITES_LIST_ID], limit: 5 },
      { maxWait: 4500 },
    );
    if (events.length === 0) return [];
    const latest = events.sort((a, b) => b.created_at - a.created_at)[0];
    if (!latest) return [];
    return parseTokenIdsFromEvent(latest.tags);
  } catch (err) {
    console.error("loadFavorites failed", err);
    return [];
  }
}

/** Save an updated favorites list (full replacement). Never throws. */
export async function saveFavorites(tokenIds: string[], privateKey: string): Promise<void> {
  try {
    const uniqueIds = [...new Set(tokenIds.filter((id) => id.length > 0))];
    const tags: string[][] = [["d", FAVORITES_LIST_ID]];
    for (const tokenId of uniqueIds) {
      tags.push(["i", `${PASSPORT_TAG_PREFIX}${tokenId}`]);
    }
    const unsigned = {
      kind: 30000,
      created_at: Math.floor(Date.now() / 1000),
      content: "",
      tags,
    };
    const signed = finalizeEvent(unsigned, toPrivateKeyBytes(privateKey));
    const pool = getNostrPool();
    await publishSignedEvent(pool, signed);
  } catch (err) {
    console.error("saveFavorites failed", err);
  }
}

/** Add one token ID to the existing favorites list. Never throws. */
export async function addFavorite(tokenId: string, privateKey: string): Promise<void> {
  try {
    const pubkey = nostrPubkeyFromPrivateKey(privateKey);
    const current = await loadFavorites(pubkey);
    if (current.includes(tokenId)) return;
    await saveFavorites([...current, tokenId], privateKey);
  } catch (err) {
    console.error("addFavorite failed", err);
  }
}

/** Remove one token ID from the existing favorites list. Never throws. */
export async function removeFavorite(tokenId: string, privateKey: string): Promise<void> {
  try {
    const pubkey = nostrPubkeyFromPrivateKey(privateKey);
    const current = await loadFavorites(pubkey);
    if (!current.includes(tokenId)) return;
    await saveFavorites(
      current.filter((id) => id !== tokenId),
      privateKey,
    );
  } catch (err) {
    console.error("removeFavorite failed", err);
  }
}
