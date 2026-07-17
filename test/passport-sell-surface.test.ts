import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { zeroAddress } from "viem";

import type { AuctionAgentAuth } from "../lib/auction/auction-agent.ts";
import {
  deriveSellSurface,
  type SellSurfaceFlags,
  type SellSurfaceInput,
} from "../lib/passport/sell-surface.ts";

const AGENT = "0x1111111111111111111111111111111111111111" as const;
const NOW = 2_000_000_000;

const allHidden: SellSurfaceFlags = {
  showList: false,
  showDelegate: false,
  showMarketplaceAuthCard: false,
  showAuctionCreate: false,
  showAuctionAuthorize: false,
  showAuctionAuthCard: false,
  showAuctionRequirementNote: false,
};

const inactiveAuctionAuth: AuctionAgentAuth = {
  agent: AGENT,
  expiry: 0n,
  asset: zeroAddress,
  ownerMinAsset: 1n,
  active: false,
};

function input(
  overrides: Partial<SellSurfaceInput> = {},
): SellSurfaceInput {
  return {
    isOwner: true,
    listingState: "inactive",
    auctionBlocks: false,
    auctionEscrowConfigured: true,
    passportStatus: "VERIFIED",
    isActiveVerifier: false,
    marketplaceAuthActive: false,
    auctionAuth: { value: inactiveAuctionAuth, now: NOW },
    ...overrides,
  };
}

describe("deriveSellSurface", () => {
  it("shows the auction requirement note for an unverified owner", () => {
    assert.deepEqual(
      deriveSellSurface(input({ passportStatus: "UNVERIFIED" })),
      {
        ...allHidden,
        showList: true,
        showDelegate: true,
        showAuctionRequirementNote: true,
      },
    );
  });

  it("shows the auction requirement note for a disputed owner", () => {
    assert.equal(
      deriveSellSurface(input({ passportStatus: "DISPUTED" }))
        .showAuctionRequirementNote,
      true,
    );
  });

  it("hides the auction requirement note when escrow is unconfigured", () => {
    assert.equal(
      deriveSellSurface(input({
        passportStatus: "UNVERIFIED",
        auctionEscrowConfigured: false,
      })).showAuctionRequirementNote,
      false,
    );
  });

  it("shows list, delegation, and auction authorization for a private owner", () => {
    assert.deepEqual(deriveSellSurface(input()), {
      ...allHidden,
      showList: true,
      showDelegate: true,
      showAuctionAuthorize: true,
    });
  });

  it("replaces auction authorization with create for a KarPro owner", () => {
    assert.deepEqual(
      deriveSellSurface(input({ isActiveVerifier: true })),
      {
        ...allHidden,
        showList: true,
        showDelegate: true,
        showAuctionCreate: true,
      },
    );
  });

  it("replaces delegation with the marketplace authorization card", () => {
    assert.deepEqual(
      deriveSellSurface(input({ marketplaceAuthActive: true })),
      {
        ...allHidden,
        showList: true,
        showMarketplaceAuthCard: true,
        showAuctionAuthorize: true,
      },
    );
  });

  it("replaces auction authorization with an active authorization card", () => {
    const activeAuth = { ...inactiveAuctionAuth, active: true };
    assert.deepEqual(
      deriveSellSurface(input({ auctionAuth: { value: activeAuth, now: NOW } })),
      {
        ...allHidden,
        showList: true,
        showDelegate: true,
        showAuctionAuthCard: true,
      },
    );
  });

  it("keeps an expired active auction authorization as a status card", () => {
    const expiredAuth = {
      ...inactiveAuctionAuth,
      active: true,
      expiry: BigInt(NOW - 1),
    };
    assert.deepEqual(
      deriveSellSurface(input({ auctionAuth: { value: expiredAuth, now: NOW } })),
      {
        ...allHidden,
        showList: true,
        showDelegate: true,
        showAuctionAuthCard: true,
      },
    );
  });

  it("hides the panel for an active listing", () => {
    assert.deepEqual(
      deriveSellSurface(input({ listingState: "active" })),
      allHidden,
    );
  });

  it("hides the panel when auction commerce owns the rail", () => {
    assert.deepEqual(
      deriveSellSurface(input({ auctionBlocks: true })),
      allHidden,
    );
  });

  it("hides the panel for a non-owner", () => {
    assert.deepEqual(
      deriveSellSurface(input({ isOwner: false })),
      allHidden,
    );
  });

  it("fails closed while listing, auction, or authorization facts are unresolved", () => {
    assert.deepEqual(
      deriveSellSurface(input({ listingState: "pending" })),
      allHidden,
    );
    assert.deepEqual(
      deriveSellSurface(input({ listingState: "failure" })),
      allHidden,
    );
    assert.deepEqual(
      deriveSellSurface(input({ auctionBlocks: undefined })),
      allHidden,
    );

    const unresolvedMarketplace = deriveSellSurface(
      input({ marketplaceAuthActive: undefined }),
    );
    assert.equal(unresolvedMarketplace.showList, true);
    assert.equal(unresolvedMarketplace.showDelegate, false);
    assert.equal(unresolvedMarketplace.showMarketplaceAuthCard, false);

    const unresolvedAuction = deriveSellSurface(
      input({ auctionAuth: undefined }),
    );
    assert.equal(unresolvedAuction.showList, true);
    assert.equal(unresolvedAuction.showAuctionCreate, false);
    assert.equal(unresolvedAuction.showAuctionAuthorize, false);
    assert.equal(unresolvedAuction.showAuctionAuthCard, false);
  });
});
