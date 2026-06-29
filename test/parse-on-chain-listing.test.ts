import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isListingRowActive,
  parseOnChainListing,
} from "../lib/marketplace/parse-on-chain-listing.ts";

const ZERO = "0x0000000000000000000000000000000000000000" as const;
const SELLER = "0xcfe194fea9727bD04dA8F78c2362680986e02dF1" as const;
const USD_CODE =
  "0x5553440000000000000000000000000000000000000000000000000000000000" as const;

describe("parseOnChainListing", () => {
  it("parses v2 tuple array with active at index 2", () => {
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
    assert.equal(row.fiatPrice1e8, 42_000_000_000_000n);
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
