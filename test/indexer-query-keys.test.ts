import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  INDEXER_QUERY_KEY_PREFIXES,
  NON_INDEXER_QUERY_KEY_PREFIXES,
  invalidateIndexerQueries,
  type IndexerQueryClient,
} from "../lib/web3/indexer-query-keys.ts";

/** Commerce / portfolio keys that must stay in the sync contract. */
const REQUIRED_COMMERCE_PREFIXES = [
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

describe("INDEXER_QUERY_KEY_PREFIXES", () => {
  it("includes every required commerce prefix exactly once", () => {
    const set = new Set(INDEXER_QUERY_KEY_PREFIXES);
    assert.equal(set.size, INDEXER_QUERY_KEY_PREFIXES.length);
    for (const prefix of REQUIRED_COMMERCE_PREFIXES) {
      assert.ok(set.has(prefix), `missing prefix: ${prefix}`);
    }
  });

  it("matches the required commerce set (no silent extras without test update)", () => {
    assert.deepEqual(
      [...INDEXER_QUERY_KEY_PREFIXES].sort(),
      [...REQUIRED_COMMERCE_PREFIXES].sort(),
    );
  });

  it("does not overlap NON_INDEXER_QUERY_KEY_PREFIXES", () => {
    const indexer = new Set<string>(INDEXER_QUERY_KEY_PREFIXES);
    for (const prefix of NON_INDEXER_QUERY_KEY_PREFIXES) {
      assert.equal(indexer.has(prefix), false, `overlap: ${prefix}`);
    }
  });
});

describe("invalidateIndexerQueries", () => {
  it("invalidates each prefix as a queryKey head", async () => {
    const seen: string[][] = [];
    const queryClient: IndexerQueryClient = {
      invalidateQueries: async ({ queryKey }) => {
        seen.push(queryKey.map(String));
      },
    };

    await invalidateIndexerQueries(queryClient);

    assert.equal(seen.length, INDEXER_QUERY_KEY_PREFIXES.length);
    assert.deepEqual(
      seen.map((k) => k[0]).sort(),
      [...INDEXER_QUERY_KEY_PREFIXES].sort(),
    );
    for (const key of seen) {
      assert.equal(key.length, 1);
    }
  });
});
