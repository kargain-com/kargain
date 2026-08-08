import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { zeroAddress } from "viem";

import { DENOMINATION_KIND } from "../lib/commerce/denomination.ts";
import {
  buildOnChainListing,
  isListingRowActive,
  parseOnChainListing,
} from "../lib/marketplace/parse-on-chain-listing.ts";

const ZERO = "0x0000000000000000000000000000000000000000" as const;
const SELLER = "0xcfe194fea9727bD04dA8F78c2362680986e02dF1" as const;
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
const USD_CODE =
  "0x5553440000000000000000000000000000000000000000000000000000000000" as const;

describe("parseOnChainListing", () => {
  it("parses v2 tuple array with active at index 2 as fiat legacy", () => {
    const row = parseOnChainListing([
      SELLER,
      42_000_000_000_000n,
      true,
      ZERO,
      0n,
      0,
      USD_CODE,
    ]);
    assert.ok(row);
    assert.equal(row.active, true);
    assert.equal(row.seller, SELLER);
    assert.equal(row.price, 42_000_000_000_000n);
    assert.equal(row.denominationKind, DENOMINATION_KIND.Fiat);
    assert.equal(row.fiatCurrency, 0);
  });

  it("does not treat zero agent address as active (v1 parser bug)", () => {
    const row = parseOnChainListing([
      ZERO,
      0n,
      false,
      ZERO,
      0n,
      0,
      USD_CODE,
    ]);
    assert.ok(row);
    assert.equal(row.active, false);
  });

  it("parses v2 object shape from wagmi", () => {
    const row = parseOnChainListing({
      seller: SELLER,
      fiatPrice1e8: 10_000_000_000n,
      active: true,
      agent: ZERO,
      ownerMinPrice1e8: 0n,
      agentFeeBps: 0,
      currencyCode: USD_CODE,
    });
    assert.ok(row);
    assert.equal(row.active, true);
    assert.equal(row.fiatCurrency, 0);
  });

  it("rejects active flag with zero seller or zero price", () => {
    assert.equal(isListingRowActive(true, ZERO, 100n), false);
    assert.equal(isListingRowActive(true, SELLER, 0n), false);
    assert.equal(isListingRowActive(false, SELLER, 100n), false);
    assert.equal(isListingRowActive(true, SELLER, 100n), true);
  });
});

describe("buildOnChainListing", () => {
  it("keeps asset price as raw units (not fiat 1e8)", () => {
    const row = buildOnChainListing({
      phase: 1,
      seller: SELLER,
      price: 350000000000n,
      currencyCode: "0x" + "0".repeat(64),
      denominationKind: DENOMINATION_KIND.Asset,
      asset: USDC,
    });
    assert.ok(row);
    assert.equal(row.active, true);
    assert.equal(row.denominationKind, DENOMINATION_KIND.Asset);
    assert.equal(row.price, 350000000000n);
    assert.equal(row.asset.toLowerCase(), USDC.toLowerCase());
  });

  it("returns null while phase unread", () => {
    assert.equal(
      buildOnChainListing({
        phase: undefined,
        seller: SELLER,
        price: 1n,
        currencyCode: USD_CODE,
        denominationKind: DENOMINATION_KIND.Fiat,
        asset: zeroAddress,
      }),
      null,
    );
  });
});
