import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveEffectiveListing } from "../lib/marketplace/effective-listing.ts";
import type { OnChainListingRow } from "../lib/marketplace/parse-on-chain-listing.ts";

const CHAIN_SELLER = "0x1111111111111111111111111111111111111111" as const;
const PONDER_SELLER = "0x2222222222222222222222222222222222222222" as const;

const activeChainRow: OnChainListingRow = {
  seller: CHAIN_SELLER,
  fiatPrice1e8: 25_000_000_000n,
  fiatCurrency: 0,
  active: true,
};

const stalePonderListing = {
  seller: PONDER_SELLER,
  fiatPrice1e8: "20000000000",
  fiatCurrency: 0,
  active: true,
};

describe("resolveEffectiveListing", () => {
  it("uses an active chain row after a successful read", () => {
    const listing = resolveEffectiveListing(
      "success",
      activeChainRow,
      stalePonderListing,
    );

    assert.deepEqual(listing, {
      active: true,
      seller: CHAIN_SELLER,
      fiatPrice1e8: "25000000000",
      fiatCurrency: 0,
    });
  });

  it("returns null for successful inactive chain state despite stale Ponder data", () => {
    const inactiveChainRow: OnChainListingRow = {
      ...activeChainRow,
      fiatPrice1e8: 0n,
      active: false,
    };

    assert.equal(
      resolveEffectiveListing(
        "success",
        inactiveChainRow,
        stalePonderListing,
      ),
      null,
    );
  });

  it("uses Ponder while the chain read is pending", () => {
    const listing = resolveEffectiveListing(
      "pending",
      null,
      stalePonderListing,
    );

    assert.equal(listing?.seller, PONDER_SELLER);
  });

  it("uses Ponder when the chain read failed", () => {
    const listing = resolveEffectiveListing(
      "failure",
      null,
      stalePonderListing,
    );

    assert.equal(listing?.seller, PONDER_SELLER);
  });
});
