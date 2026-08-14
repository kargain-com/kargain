/**
 * Indexer → edge HTTP freshness classes.
 *
 * This is **not** Truth layers T1–T6 (see docs/REFERENCE.md). T3 owns
 * app → indexer reads via Next `"use cache"` + tags + `updateTag` from `syncReads`.
 * These classes own response `Cache-Control` / `ETag` on the Ponder Hono API
 * for Cloudflare (and conditional revalidation). Names deliberately omit a
 * `T` prefix so they cannot be read as an extension of T1–T6.
 */

/**
 * Protocol-projection classes (`catalog` / `entity` / `account`) keep
 * **zero** edge TTL. Positive `s-maxage` / SWR here would let CF serve pre-tx
 * bodies after T4 proved the indexer advanced. User-tx freshness is Next
 * Data Cache (`updateTag` from `syncReads`), not Cloudflare purge. ETag +
 * conditional 304 still save body bytes without storing a stale shared copy.
 */
export const HTTP_FRESHNESS_CLASSES = {
  /** Timelock-paced commerce config — action gates read chain (not indexer). */
  config: {
    id: "config" as const,
    cacheControl:
      "public, max-age=30, s-maxage=300, stale-while-revalidate=60",
  },
  /** Browse / directory / portfolio lists — zero edge TTL (Next Data Cache owns freshness). */
  catalog: {
    id: "catalog" as const,
    cacheControl: "public, max-age=0, s-maxage=0, must-revalidate",
  },
  /** Single-record (and small batch) GETs — zero edge TTL (Next Data Cache owns freshness). */
  entity: {
    id: "entity" as const,
    cacheControl: "public, max-age=0, s-maxage=0, must-revalidate",
  },
  /** Address-scoped feeds — zero edge TTL (Next Data Cache owns freshness). */
  account: {
    id: "account" as const,
    cacheControl: "public, max-age=0, s-maxage=0, must-revalidate",
  },
  /** Must not be stored at the edge (availability races). */
  ephemeral: {
    id: "ephemeral" as const,
    cacheControl: "private, no-store",
  },
} as const;

export type HttpFreshnessClassId = keyof typeof HTTP_FRESHNESS_CLASSES;

/**
 * Exact Hono path → freshness class. Every `app.get("…")` in
 * `src/api/index.ts` + `commerce-routes.ts` must appear exactly once.
 * Missing entry = policy test failure (not a silent long TTL).
 */
export const HONO_ROUTE_HTTP_FRESHNESS: readonly {
  path: string;
  classId: HttpFreshnessClassId;
}[] = [
  // Specific /consignments/* before /consignments/:id
  { path: "/consignments/by-token/:tokenId", classId: "entity" },
  { path: "/consignments/:id/bids", classId: "entity" },
  { path: "/consignments/:id", classId: "entity" },
  { path: "/consignments", classId: "catalog" },

  { path: "/accounts/:address/obligations", classId: "account" },
  { path: "/accounts/:address/claims", classId: "account" },
  { path: "/agents/:address/mandates", classId: "catalog" },
  { path: "/owners/:address/mandates", classId: "catalog" },
  { path: "/agents/:address/consignments", classId: "catalog" },

  { path: "/commerce-claim-credits", classId: "catalog" },
  { path: "/challenges", classId: "catalog" },
  { path: "/commerce-modes", classId: "config" },
  { path: "/commerce-payment-tokens", classId: "config" },
  { path: "/commerce-currency-feeds", classId: "config" },

  { path: "/passports/batch", classId: "entity" },
  { path: "/passports/:tokenId", classId: "entity" },
  { path: "/passports", classId: "catalog" },
  { path: "/profile/:address/passports", classId: "catalog" },
  { path: "/notifications/:address", classId: "account" },

  { path: "/verifiers/by-slug/:slug", classId: "entity" },
  { path: "/verifiers/slug-available/:slug", classId: "ephemeral" },
  { path: "/verifiers/:address/attestations", classId: "entity" },
  { path: "/verifiers/:address", classId: "entity" },
  { path: "/verifiers", classId: "catalog" },
] as const;

const BY_PATH = new Map(
  HONO_ROUTE_HTTP_FRESHNESS.map((e) => [e.path, e.classId] as const),
);

export function httpFreshnessClassForRoutePath(
  routePath: string,
): HttpFreshnessClassId | undefined {
  return BY_PATH.get(routePath);
}

export function cacheControlForClass(classId: HttpFreshnessClassId): string {
  return HTTP_FRESHNESS_CLASSES[classId].cacheControl;
}
