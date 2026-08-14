/**
 * Sole Next Data Cache boundary for mutable Ponder projections.
 * Every call requires an {@link IndexerQueryKeyPrefix} — untagged reads are
 * a type error. Invalidation: `syncReads` → `updateTag` (see T3/T4).
 *
 * Not for `/status` (T4 wait) or non-Next CLI — those use transport.
 */

import { cacheLife, cacheTag } from "next/cache";

import type { IndexerQueryKeyPrefix } from "@/lib/web3/indexer-query-keys";
import { ponderTransportFetch } from "@/lib/web3/ponder-fetch-transport";

export type PonderTaggedResult = {
  status: number;
  ok: boolean;
  body: unknown;
};

/**
 * Tagged `"use cache"` read. Cache key = arguments (`tag`, `url`);
 * invalidation axis = `tag` (coarse: all filter variants share one tag).
 *
 * Inner fetch uses `cache: "no-store"` so the Next fetch cache does not
 * dual-store under this boundary — `"use cache"` is the only memoization.
 */
export async function ponderTaggedJson(
  tag: IndexerQueryKeyPrefix,
  url: string,
): Promise<PonderTaggedResult> {
  "use cache";
  cacheTag(tag);
  // Fallback TTL if updateTag is missed; post-tx path uses updateTag (immediate).
  cacheLife({ stale: 60, revalidate: 300, expire: 3600 });

  try {
    const res = await ponderTransportFetch(url, { cache: "no-store" });
    const text = await res.text();
    let body: unknown = null;
    if (text.length > 0) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        body = null;
      }
    }
    return { status: res.status, ok: res.ok, body };
  } catch {
    // Network / prerender when indexer unreachable — same as HTTP fail for callers.
    return { status: 0, ok: false, body: null };
  }
}
