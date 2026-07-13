import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AUCTION_PHASE,
  auctionCreatedRow,
  bidRowId,
  normalizeAuctionAgent,
  normalizeAuctionAsset,
  settlementDisputeOutcomeLabel,
  voidReasonLabel,
} from "../src/lib/ponder-auction.ts";

describe("bidRowId", () => {
  it("joins tx hash and log index", () => {
    assert.equal(
      bidRowId("0xabc", 3),
      "0xabc-3",
    );
  });
});

describe("normalizeAuctionAsset", () => {
  it("maps zero address to empty string", () => {
    assert.equal(
      normalizeAuctionAsset("0x0000000000000000000000000000000000000000"),
      "",
    );
  });

  it("preserves token addresses", () => {
    const usdc = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
    assert.equal(normalizeAuctionAsset(usdc), usdc);
  });
});

describe("normalizeAuctionAgent", () => {
  it("maps zero address to empty string", () => {
    assert.equal(
      normalizeAuctionAgent("0x0000000000000000000000000000000000000000"),
      "",
    );
  });
});

describe("voidReasonLabel", () => {
  it("maps known enum values", () => {
    assert.equal(voidReasonLabel(0), "UnverifiedPassport");
    assert.equal(voidReasonLabel(1), "DisputeGraceExpired");
  });
});

describe("settlementDisputeOutcomeLabel", () => {
  it("maps known enum values", () => {
    assert.equal(settlementDisputeOutcomeLabel(0), "ReleaseToSeller");
    assert.equal(settlementDisputeOutcomeLabel(1), "ConfirmFailure");
  });
});

describe("auctionCreatedRow", () => {
  it("initializes CREATED phase with empty high bid", () => {
    const row = auctionCreatedRow({
      tokenId: "8453200000000000000000000000000000000000000000000000000000000001",
      seller: "0xSeller",
      agent: "0x0000000000000000000000000000000000000000",
      asset: "0x0000000000000000000000000000000000000000",
      reserve: 1_000_000n,
      duration: 86_400n,
      agentFeeBps: 0,
      ownerMinAsset: 0n,
      timestamp: 100n,
    });

    assert.equal(row.phase, AUCTION_PHASE.CREATED);
    assert.equal(row.agent, "");
    assert.equal(row.asset, "");
    assert.equal(row.highestBid, 0n);
    assert.equal(row.active, true);
    assert.equal(row.startedAt, 0n);
  });
});
