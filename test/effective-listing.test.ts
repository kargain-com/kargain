import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { zeroAddress } from "viem";

import { DENOMINATION_KIND } from "../lib/commerce/denomination.ts";
import { resolveEffectiveListing } from "../lib/marketplace/effective-listing.ts";
import type { OnChainListingRow } from "../lib/marketplace/parse-on-chain-listing.ts";

const CHAIN_SELLER = "0x1111111111111111111111111111111111111111" as const;
const PONDER_SELLER = "0x2222222222222222222222222222222222222222" as const;
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;

const activeChainRow: OnChainListingRow = {
  seller: CHAIN_SELLER,
  price: 25_000_000_000n,
  denominationKind: DENOMINATION_KIND.Fiat,
  asset: zeroAddress,
  currencyCode:
    "0x5553440000000000000000000000000000000000000000000000000000000000",
  fiatCurrency: 0,
  active: true,
};

const stalePonderListing = {
  seller: PONDER_SELLER,
  price: "20000000000",
  fiatPrice1e8: "20000000000",
  denominationKind: DENOMINATION_KIND.Fiat,
  asset: zeroAddress,
  currencyCode: "USD",
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
      price: "25000000000",
      denominationKind: DENOMINATION_KIND.Fiat,
      asset: zeroAddress,
      currencyCode: activeChainRow.currencyCode,
      fiatCurrency: 0,
    });
  });

  it("returns null for successful inactive chain state despite stale Ponder data", () => {
    const inactiveChainRow: OnChainListingRow = {
      ...activeChainRow,
      price: 0n,
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

  it("carries asset denomination from chain", () => {
    const assetRow: OnChainListingRow = {
      seller: CHAIN_SELLER,
      price: 350000000000n,
      denominationKind: DENOMINATION_KIND.Asset,
      asset: USDC,
      currencyCode: "0x" + "0".repeat(64),
      fiatCurrency: 0,
      active: true,
    };
    const listing = resolveEffectiveListing("success", assetRow, null);
    assert.ok(listing);
    assert.equal(listing.denominationKind, DENOMINATION_KIND.Asset);
    assert.equal(listing.price, "350000000000");
    assert.equal(listing.asset.toLowerCase(), USDC.toLowerCase());
  });
});
