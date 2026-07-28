import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  deriveAuctionUiState,
  filterBidsForAuction,
  mapPonderAuctionBid,
  mapPonderAuctionRow,
  marketplaceListingBlocksAuction,
  partitionActiveAuctions,
  type AuctionBid,
  type AuctionRow,
  type PonderAuctionRaw,
} from "../lib/auction/map-ponder-auction.ts";

function raw(overrides: Partial<PonderAuctionRaw> = {}): PonderAuctionRaw {
  return {
    id: "1",
    tokenId: "1",
    chainId: 84532,
    seller: "0x1111111111111111111111111111111111111111",
    agent: "",
    asset: "",
    reserve: "1000000000000000000",
    duration: "259200",
    agentFeeBps: 0,
    ownerMinAsset: "0",
    startedAt: "0",
    endsAt: "0",
    highestBidder: "",
    highestBid: "0",
    active: true,
    phase: "CREATED",
    returnRequestedAt: null,
    createdAt: "1000",
    updatedAt: "1000",
    passportStatus: "VERIFIED",
    ...overrides,
  };
}

describe("mapPonderAuctionRow", () => {
  it("maps string bigints and labels empty asset as ETH", () => {
    const row = mapPonderAuctionRow(raw());
    assert.equal(row.reserve, 10n ** 18n);
    assert.equal(row.assetLabel, "ETH");
    assert.equal(row.phase, "CREATED");
    assert.equal(row.active, true);
    assert.equal(row.chainId, 84532);
  });

  it("uses row chainId for spoke", () => {
    const row = mapPonderAuctionRow(raw({ chainId: 11155111 }));
    assert.equal(row.chainId, 11155111);
  });

  it("labels non-empty asset as USDC", () => {
    const row = mapPonderAuctionRow(
      raw({ asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" }),
    );
    assert.equal(row.assetLabel, "USDC");
  });
});

describe("partitionActiveAuctions (U13)", () => {
  it("orders live by endsAt asc then awaiting by createdAt desc", () => {
    const rows: AuctionRow[] = [
      mapPonderAuctionRow(raw({ tokenId: "1", endsAt: "0", createdAt: "10" })),
      mapPonderAuctionRow(raw({ tokenId: "2", endsAt: "500", createdAt: "1", startedAt: "1", phase: "BIDDING" })),
      mapPonderAuctionRow(raw({ tokenId: "3", endsAt: "0", createdAt: "50" })),
      mapPonderAuctionRow(raw({ tokenId: "4", endsAt: "200", createdAt: "2", startedAt: "1", phase: "BIDDING" })),
    ];
    const ordered = partitionActiveAuctions(rows).map((r) => r.tokenId);
    assert.deepEqual(ordered, ["4", "2", "3", "1"]);
  });
});

describe("filterBidsForAuction (U11)", () => {
  it("drops bids older than auction.createdAt", () => {
    const bids: AuctionBid[] = [
      mapPonderAuctionBid({
        id: "1",
        tokenId: "1",
        bidder: "0x2222222222222222222222222222222222222222",
        amount: "1",
        timestamp: "900",
      }),
      mapPonderAuctionBid({
        id: "2",
        tokenId: "1",
        bidder: "0x3333333333333333333333333333333333333333",
        amount: "2",
        timestamp: "1000",
      }),
      mapPonderAuctionBid({
        id: "3",
        tokenId: "1",
        bidder: "0x4444444444444444444444444444444444444444",
        amount: "3",
        timestamp: "1100",
      }),
    ];
    const filtered = filterBidsForAuction(bids, 1000n);
    assert.deepEqual(
      filtered.map((b) => b.id),
      ["2", "3"],
    );
  });
});

describe("deriveAuctionUiState (U15)", () => {
  it("derives S5 ENDED when BIDDING and now >= endsAt", () => {
    const state = deriveAuctionUiState({
      phase: "BIDDING",
      active: true,
      endsAtChain: 1000n,
      startedAt: 500n,
      passportStatus: "VERIFIED",
      now: 1000,
    });
    assert.equal(state, "S5");
  });

  it("keeps S3 while live before endsAt", () => {
    const state = deriveAuctionUiState({
      phase: "BIDDING",
      active: true,
      endsAtChain: 2000n,
      startedAt: 500n,
      passportStatus: "VERIFIED",
      now: 1500,
    });
    assert.equal(state, "S3");
  });

  it("returns S4 when live and DISPUTED", () => {
    const state = deriveAuctionUiState({
      phase: "BIDDING",
      active: true,
      endsAtChain: 2000n,
      startedAt: 500n,
      passportStatus: "DISPUTED",
      now: 1500,
    });
    assert.equal(state, "S4");
  });

  it("returns S1 when awaiting first bid", () => {
    const state = deriveAuctionUiState({
      phase: "CREATED",
      active: true,
      endsAtChain: 0n,
      startedAt: 0n,
      passportStatus: "VERIFIED",
      now: 100,
    });
    assert.equal(state, "S1");
  });

  it("returns S8 / S9 for terminal phases", () => {
    assert.equal(
      deriveAuctionUiState({
        phase: "RELEASED",
        active: false,
        endsAtChain: 1n,
        startedAt: 1n,
        passportStatus: "VERIFIED",
        now: 9,
      }),
      "S8",
    );
    assert.equal(
      deriveAuctionUiState({
        phase: "CANCELLED",
        active: false,
        endsAtChain: 1n,
        startedAt: 1n,
        passportStatus: "UNVERIFIED",
        now: 9,
      }),
      "S9",
    );
  });
});

describe("marketplaceListingBlocksAuction", () => {
  it("blocks when Ponder listing is active", () => {
    assert.equal(
      marketplaceListingBlocksAuction({
        ponderActive: true,
        chainIsListed: false,
        chainListedPending: false,
      }),
      true,
    );
  });

  it("blocks when chain isListed is true", () => {
    assert.equal(
      marketplaceListingBlocksAuction({
        ponderActive: false,
        chainIsListed: true,
        chainListedPending: false,
      }),
      true,
    );
  });

  it("fail-closed while chain isListed is pending", () => {
    assert.equal(
      marketplaceListingBlocksAuction({
        ponderActive: false,
        chainIsListed: undefined,
        chainListedPending: true,
      }),
      true,
    );
  });

  it("allows auction create when not listed and chain resolved", () => {
    assert.equal(
      marketplaceListingBlocksAuction({
        ponderActive: false,
        chainIsListed: false,
        chainListedPending: false,
      }),
      false,
    );
  });
});
