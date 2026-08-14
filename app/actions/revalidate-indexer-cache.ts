"use server";

import { updateTag } from "next/cache";

import { INDEXER_QUERY_KEY_PREFIXES } from "@/lib/web3/indexer-query-keys";

export type RevalidateIndexerCacheResult =
  | { ok: true }
  | { ok: false };

/**
 * Sole Next Data Cache invalidation for Ponder projections (T3/T4).
 * Called only from `useTxSync.syncReads` after the indexer advanced.
 * Uses `updateTag` (immediate expire) — not SWR `revalidateTag` with profile `'max'`.
 */
export async function revalidateIndexerCache(): Promise<RevalidateIndexerCacheResult> {
  try {
    for (const tag of INDEXER_QUERY_KEY_PREFIXES) {
      updateTag(tag);
    }
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
