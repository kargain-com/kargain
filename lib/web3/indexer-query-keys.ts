/**
 * React Query key prefixes that read Ponder (or Ponder-backed server actions).
 * After `useTxSync` waits for the receipt block on the indexer, these must be
 * invalidated together with wagmi chain reads — otherwise browse/portfolio UI
 * can stay on a pre-tx cache while detail surfaces already show chain truth.
 *
 * When adding a new Ponder-backed `queryKey`, append its first segment here.
 */
export const INDEXER_QUERY_KEY_PREFIXES = [
  "marketplace-listings",
  "watchlist-listings",
  "watchlist-batch",
  "auction-browse",
  "auction-detail",
  "auction-bids",
  "agent-awaiting",
  "agent-awaiting-passports",
  "agent-listings",
  "agent-auction-awaiting",
  "agent-auction-active",
  "owner-delegated-auths",
  "owner-delegated-auction-auths",
  "owner-delegated-profile",
  "owner-delegated-auctions",
  "owner-delegated-passports",
  "pro-active-consignments",
  "ponder-notifications",
  "owned-passport-token-ids",
  "kar-pro-verifier",
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
