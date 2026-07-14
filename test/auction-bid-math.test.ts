import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { minNextBid } from "../lib/auction/auction-bid-math.ts";

describe("minNextBid", () => {
  it("first bid minimum equals reserve when highestBid is 0", () => {
    assert.equal(minNextBid(0n, 300, 1_500_000_000_000_000_000n), 1_500_000_000_000_000_000n);
  });

  it("applies floor increment matching Solidity", () => {
    // 1 ETH + 3% = 1.03 ETH
    const highest = 10n ** 18n;
    assert.equal(minNextBid(highest, 300, 1n), highest + (highest * 300n) / 10_000n);
    assert.equal(minNextBid(highest, 300, 1n), 1_030_000_000_000_000_000n);
  });

  it("floors fractional wei (no ceil)", () => {
    // 100 wei * 300 / 10000 = 3; 100 + 3 = 103
    assert.equal(minNextBid(100n, 300, 50n), 103n);
  });

  it("ignores reserve once bidding has started", () => {
    assert.equal(minNextBid(1_000_000n, 300, 9_000_000n), 1_030_000n);
  });
});
