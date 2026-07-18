import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatMarketplaceStatsLine } from "@/lib/marketplace/marketplace-stats-line";

describe("formatMarketplaceStatsLine", () => {
  it("returns null when every count is zero", () => {
    assert.equal(
      formatMarketplaceStatsLine({
        listings: 0,
        auctions: 0,
        verified: 0,
        activeVerifiers: 0,
      }),
      null,
    );
  });

  it("formats listings and active verifiers without auctions", () => {
    assert.equal(
      formatMarketplaceStatsLine({
        listings: 1,
        auctions: 0,
        verified: 0,
        activeVerifiers: 1,
      }),
      "1 listings · 1 active verifiers",
    );
  });

  it("includes active auctions between listings and verified", () => {
    assert.equal(
      formatMarketplaceStatsLine({
        listings: 42,
        auctions: 3,
        verified: 12,
        activeVerifiers: 5,
      }),
      "42 listings · 3 auctions · 12 verified · 5 active verifiers",
    );
  });

  it("omits zero segments and still joins remaining parts", () => {
    assert.equal(
      formatMarketplaceStatsLine({
        listings: 0,
        auctions: 2,
        verified: 0,
        activeVerifiers: 0,
      }),
      "2 auctions",
    );
    assert.equal(
      formatMarketplaceStatsLine({
        listings: 0,
        auctions: 1,
        verified: 4,
        activeVerifiers: 0,
      }),
      "1 auctions · 4 verified",
    );
  });

  it("rejects negative and treats them as absent via > 0 gate", () => {
    assert.equal(
      formatMarketplaceStatsLine({
        listings: -1,
        auctions: 0,
        verified: 0,
        activeVerifiers: 2,
      }),
      "2 active verifiers",
    );
  });
});
