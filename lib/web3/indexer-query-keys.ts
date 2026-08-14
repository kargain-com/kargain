/**
 * React Query key prefixes that read Ponder (or Ponder-backed server actions).
 * After `useTxSync` waits for the receipt block on the indexer, these must be
 * invalidated together with wagmi chain reads — otherwise browse/portfolio UI
 * can stay on a pre-tx cache while detail surfaces already show chain truth.
 *
 * When adding a client `queryKey: ["prefix", …]` under hooks/ or components/:
 * 1. If it reads mutable Ponder state → append `prefix` here.
 * 2. Otherwise → append to `NON_INDEXER_QUERY_KEY_PREFIXES`.
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
] as const;

/**
 * First segments of React Query keys that are intentionally *not* Ponder
 * protocol-state caches (Nostr, FX, content-addressed metadata, Vincent).
 * Coverage tests require every scanned `queryKey` prefix to live in
 * INDEXER_QUERY_KEY_PREFIXES or here.
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

export type IndexerQueryKeyPrefix = (typeof INDEXER_QUERY_KEY_PREFIXES)[number];

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
