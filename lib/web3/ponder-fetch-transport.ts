/**
 * Low-level Ponder HTTP transport — no cache policy.
 * Product projection reads go through {@link ponderTaggedJson} (`"use cache"` + tag).
 * Only `/status` (T4 wait) and CLI/test injects may call this directly.
 */

const DEFAULT_PONDER_BASE_URL = "http://localhost:42069";

/** Fetch init that may set `cache` (DOM / undici); Node `@types` omit it. */
type PonderFetchInit = RequestInit & {
  cache?:
    | "default"
    | "force-cache"
    | "no-cache"
    | "no-store"
    | "only-if-cached"
    | "reload";
};

/** Trimmed `PONDER_SQL_API_URL`, or local Ponder default. */
export function ponderBaseUrl(
  envValue: string | undefined = process.env.PONDER_SQL_API_URL,
): string {
  const trimmed = envValue?.trim().replace(/\/+$/, "") ?? "";
  return trimmed || DEFAULT_PONDER_BASE_URL;
}

/** Bare `fetch` — no Next Data Cache policy. */
export function ponderTransportFetch(
  input: string | URL,
  init?: PonderFetchInit,
): Promise<Response> {
  return fetch(input, init);
}

/**
 * Uncached status fetch for T4 `waitForIndexerBlock`.
 * Must not enter durable `"use cache"` — polling would lie.
 */
export function ponderStatusFetch(url: string): Promise<Response> {
  return ponderTransportFetch(url, { cache: "no-store" });
}
