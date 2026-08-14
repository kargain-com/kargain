/**
 * Ponder HTTP transport only — forced `cache: "no-store"`.
 * Product URL build / parse lives in ponder-client.ts; import via ponder-fetch.ts.
 */

const DEFAULT_PONDER_BASE_URL = "http://localhost:42069";

/** Trimmed `PONDER_SQL_API_URL`, or local Ponder default. */
export function ponderBaseUrl(
  envValue: string | undefined = process.env.PONDER_SQL_API_URL,
): string {
  const trimmed = envValue?.trim().replace(/\/+$/, "") ?? "";
  return trimmed || DEFAULT_PONDER_BASE_URL;
}

/**
 * `fetch` for Ponder state URLs. Forces `cache: "no-store"` and drops Next
 * `next.revalidate` so caller cache hints cannot win.
 */
export function ponderFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  if (init == null) {
    return fetch(input, { cache: "no-store" });
  }
  const { next: _next, ...rest } = init as RequestInit & { next?: unknown };
  return fetch(input, { ...rest, cache: "no-store" });
}
