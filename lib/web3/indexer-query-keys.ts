/**
 * React Query key prefixes that read Ponder (or Ponder-backed server actions).
 * After `useTxSync` waits for the receipt block on the indexer, these must be
 * invalidated together with wagmi chain reads — otherwise browse/portfolio UI
 * can stay on a pre-tx cache while detail surfaces already show chain truth.
 *
 * Same strings are Next `"use cache"` / `cacheTag` / `updateTag` labels (T3).
 *
 * When adding a client `queryKey: ["prefix", …]` under hooks/ or components/:
 * 1. If it reads mutable Ponder state → append `prefix` here.
 * 2. Otherwise → append to `NON_INDEXER_QUERY_KEY_PREFIXES`.
 * 3. If the key is network-scoped → build with {@link indexerQueryKey}
 *    (namespace as the second segment). Global keys stay `[prefix, …parts]`.
 * Coverage: `test/indexer-query-key-coverage.test.ts`.
 */
export const INDEXER_QUERY_KEY_PREFIXES = [
  "marketplace-listings",
  "watchlist-listings",
  "watchlist-batch",
  "consignments",
  "consignment-detail",
  "consignment-bids",
  "ascending-browse",
  "mandates",
  "agent-mandates",
  "agent-consignments",
  "owner-mandates",
  "owner-consignments",
  "owner-delegated-passports",
  "challenges",
  "pro-active-consignments",
  "outstanding-obligations",
  "ponder-notifications",
  "owned-passport-token-ids",
  "kar-pro-verifier",
  "kar-pro-slug-availability",
  "pending-claims",
  "commerce-open-options",
  "commerce-payment-tokens",
  "commerce-modes",
  "commerce-currency-feeds",
  "passport-detail",
  "passports",
  "verifiers",
  "profile-passports",
] as const;

/**
 * Indexer prefixes whose React Query keys must carry a commercial namespace
 * as segment `[1]` via {@link indexerQueryKey}.
 */
export const NETWORK_SCOPED_INDEXER_PREFIXES = [
  "consignment-detail",
  "ascending-browse",
  "agent-mandates",
  "agent-consignments",
  "owner-mandates",
  "owner-consignments",
  "kar-pro-verifier",
  "commerce-open-options",
] as const satisfies ReadonlyArray<(typeof INDEXER_QUERY_KEY_PREFIXES)[number]>;

/**
 * First segments of React Query keys that are intentionally *not* Ponder
 * protocol-state caches (Nostr, FX, content-addressed metadata, Vincent).
 * Coverage tests require every scanned `queryKey` prefix to live in
 * INDEXER_QUERY_KEY_PREFIXES or here.
 *
 * Network-scoped non-indexer keys (e.g. `kar-pro-slug`) still use
 * {@link indexerQueryKey} so the namespace sits at `[1]`.
 */
export const NON_INDEXER_QUERY_KEY_PREFIXES = [
  "readContract",
  "readContracts",
  "nostr-profile",
  "coingecko-fx-rates",
  "kar-pro-slug",
  "vincent-commons-queue",
  "vincent-registry-publishers",
  "commons-confirmation-attested-pubkeys",
  "commons-review-attested-pubkeys",
] as const;

/** Non-indexer prefixes that still embed a commercial namespace at `[1]`. */
export const NETWORK_SCOPED_NON_INDEXER_PREFIXES = ["kar-pro-slug"] as const;

export type IndexerQueryKeyPrefix = (typeof INDEXER_QUERY_KEY_PREFIXES)[number];

/**
 * Sole builder for network-scoped React Query keys (S8-1).
 * Shape: `[prefix, String(namespace), …parts]` — namespace is always segment 1.
 */
export function indexerQueryKey(
  prefix: string,
  namespace: string | number | bigint,
  ...parts: readonly unknown[]
): readonly unknown[] {
  return [prefix, String(namespace), ...parts];
}

/** Minimal QueryClient surface — avoids importing React Query types into tests. */
export type IndexerQueryClient = {
  invalidateQueries: (filters: { queryKey: readonly unknown[] }) => Promise<unknown>;
};

export async function invalidateIndexerQueries(
  queryClient: IndexerQueryClient,
): Promise<void> {
  await Promise.all(
    INDEXER_QUERY_KEY_PREFIXES.map((prefix) =>
      queryClient.invalidateQueries({ queryKey: [prefix] }),
    ),
  );
}
