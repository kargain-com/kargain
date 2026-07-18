import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { zeroAddress } from "viem";

import {
  deriveAuctionConsignment,
  deriveFixedPriceConsignment,
  type AuctionConsignmentInput,
  type FixedPriceConsignmentInput,
} from "../lib/consignment/lifecycle.ts";

const TOKEN = "123";
const AGENT = "0x1111111111111111111111111111111111111111";
const NOW = 2_000_000_000;

function fixed(
  overrides: Partial<FixedPriceConsignmentInput> = {},
): FixedPriceConsignmentInput {
  return {
    tokenId: TOKEN,
    nowSec: NOW,
    authActive: false,
    authExpiry: 0n,
    listingActive: false,
    listingAgent: null,
    returnRequestedAt: 0n,
    ...overrides,
  };
}

function auction(
  overrides: Partial<AuctionConsignmentInput> = {},
): AuctionConsignmentInput {
  return {
    tokenId: TOKEN,
    nowSec: NOW,
    authActive: false,
    authExpiry: 0n,
    authAgent: null,
    auction: null,
    ...overrides,
  };
}

describe("deriveFixedPriceConsignment", () => {
  it("returns M1 when authorization is active and not expired", () => {
    const result = deriveFixedPriceConsignment(
      fixed({
        authActive: true,
        authExpiry: BigInt(NOW + 3600),
      }),
    );
    assert.equal(result.stateId, "M1");
    assert.equal(result.track, "fixed_price");
    assert.equal(result.attention, false);
    assert.equal(result.statusLabel, "Awaiting listing");
    assert.equal(result.primaryHref, `/marketplace/${TOKEN}`);
  });

  it("returns M1 when expiry is 0 (never expires)", () => {
    const result = deriveFixedPriceConsignment(
      fixed({ authActive: true, authExpiry: 0n }),
    );
    assert.equal(result.stateId, "M1");
    assert.equal(result.attention, false);
  });

  it("returns M1e when authorization is expired", () => {
    const result = deriveFixedPriceConsignment(
      fixed({
        authActive: true,
        authExpiry: BigInt(NOW - 1),
      }),
    );
    assert.equal(result.stateId, "M1e");
    assert.equal(result.attention, true);
    assert.equal(result.statusLabel, "Authorization expired");
  });

  it("returns M2 for an active listing with agent", () => {
    const result = deriveFixedPriceConsignment(
      fixed({
        authActive: true,
        listingActive: true,
        listingAgent: AGENT,
      }),
    );
    assert.equal(result.stateId, "M2");
    assert.equal(result.attention, false);
    assert.equal(result.statusLabel, "Listed");
  });

  it("returns M2r when return is requested on an active agent listing", () => {
    const result = deriveFixedPriceConsignment(
      fixed({
        authActive: true,
        listingActive: true,
        listingAgent: AGENT,
        returnRequestedAt: BigInt(NOW - 100),
      }),
    );
    assert.equal(result.stateId, "M2r");
    assert.equal(result.attention, true);
    assert.equal(result.statusLabel, "Return requested");
  });

  it("prefers listing states over authorization-only", () => {
    const result = deriveFixedPriceConsignment(
      fixed({
        authActive: true,
        authExpiry: BigInt(NOW - 1),
        listingActive: true,
        listingAgent: AGENT,
      }),
    );
    assert.equal(result.stateId, "M2");
  });

  it("does not treat listing without agent as M2", () => {
    const result = deriveFixedPriceConsignment(
      fixed({
        authActive: true,
        authExpiry: 0n,
        listingActive: true,
        listingAgent: zeroAddress,
      }),
    );
    assert.equal(result.stateId, "M1");
  });

  it("fail-closes when authActive is unresolved", () => {
    const result = deriveFixedPriceConsignment(
      fixed({ authActive: undefined }),
    );
    assert.equal(result.stateId, "none");
    assert.equal(result.statusLabel, "");
    assert.equal(result.attention, false);
  });

  it("fail-closes when listingActive is unresolved", () => {
    const result = deriveFixedPriceConsignment(
      fixed({ listingActive: undefined }),
    );
    assert.equal(result.stateId, "none");
  });

  it("returns none when idle", () => {
    assert.equal(deriveFixedPriceConsignment(fixed()).stateId, "none");
  });
});

describe("deriveAuctionConsignment", () => {
  it("returns A1 when auth is usable and there is no auction row", () => {
    const result = deriveAuctionConsignment(
      auction({
        authActive: true,
        authExpiry: BigInt(NOW + 3600),
        authAgent: AGENT,
        auction: null,
      }),
    );
    assert.equal(result.stateId, "A1");
    assert.equal(result.track, "auction");
    assert.equal(result.attention, false);
    assert.equal(result.statusLabel, "Authorized");
    assert.equal(result.primaryHref, `/marketplace/${TOKEN}`);
  });

  it("returns A1e when auction authorization is expired", () => {
    const result = deriveAuctionConsignment(
      auction({
        authActive: true,
        authExpiry: BigInt(NOW - 1),
        authAgent: AGENT,
        auction: null,
      }),
    );
    assert.equal(result.stateId, "A1e");
    assert.equal(result.attention, true);
    assert.equal(result.statusLabel, "Authorization expired");
  });

  it("returns A2 for pre-start auction (S1)", () => {
    const result = deriveAuctionConsignment(
      auction({
        authActive: true,
        authAgent: AGENT,
        auction: {
          active: true,
          phase: "CREATED",
          startedAt: 0n,
          endsAtChain: 0n,
          returnRequestedAt: 0n,
          passportStatus: "VERIFIED",
        },
      }),
    );
    assert.equal(result.stateId, "A2");
    assert.equal(result.statusLabel, "Awaiting first bid");
    assert.equal(result.attention, false);
  });

  it("returns A2r for S1 with return requested", () => {
    const result = deriveAuctionConsignment(
      auction({
        authActive: true,
        authAgent: AGENT,
        auction: {
          active: true,
          phase: "BIDDING",
          startedAt: 0n,
          endsAtChain: BigInt(NOW + 86400),
          returnRequestedAt: BigInt(NOW - 10),
          passportStatus: "VERIFIED",
        },
      }),
    );
    assert.equal(result.stateId, "A2r");
    assert.equal(result.attention, true);
    assert.equal(result.statusLabel, "Return requested");
  });

  it("returns A3 for live bidding (S3)", () => {
    const result = deriveAuctionConsignment(
      auction({
        auction: {
          active: true,
          phase: "BIDDING",
          startedAt: BigInt(NOW - 100),
          endsAtChain: BigInt(NOW + 86400),
          returnRequestedAt: 0n,
          passportStatus: "VERIFIED",
        },
      }),
    );
    assert.equal(result.stateId, "A3");
    assert.equal(result.statusLabel, "Live auction");
    assert.equal(result.attention, false);
  });

  it("returns A3 for disputed live bidding (S4)", () => {
    const result = deriveAuctionConsignment(
      auction({
        auction: {
          active: true,
          phase: "BIDDING",
          startedAt: BigInt(NOW - 100),
          endsAtChain: BigInt(NOW + 86400),
          returnRequestedAt: 0n,
          passportStatus: "DISPUTED",
        },
      }),
    );
    assert.equal(result.stateId, "A3");
  });

  it("falls through terminal S5 to auth-only A1", () => {
    const result = deriveAuctionConsignment(
      auction({
        authActive: true,
        authExpiry: 0n,
        authAgent: AGENT,
        auction: {
          active: true,
          phase: "BIDDING",
          startedAt: BigInt(NOW - 1000),
          endsAtChain: BigInt(NOW - 1),
          returnRequestedAt: 0n,
          passportStatus: "VERIFIED",
        },
      }),
    );
    assert.equal(result.stateId, "A1");
  });

  it("falls through SETTLED to none when auth is inactive", () => {
    const result = deriveAuctionConsignment(
      auction({
        authActive: false,
        auction: {
          active: false,
          phase: "SETTLED",
          startedAt: 1n,
          endsAtChain: BigInt(NOW - 100),
          returnRequestedAt: 0n,
          passportStatus: "VERIFIED",
        },
      }),
    );
    assert.equal(result.stateId, "none");
  });

  it("fail-closes when auction truth is unresolved", () => {
    const result = deriveAuctionConsignment(
      auction({
        authActive: true,
        authAgent: AGENT,
        auction: undefined,
      }),
    );
    assert.equal(result.stateId, "none");
  });

  it("returns none when idle with null auction and no auth", () => {
    assert.equal(deriveAuctionConsignment(auction()).stateId, "none");
  });

  it("fail-closes auth-only when authActive is unresolved", () => {
    const result = deriveAuctionConsignment(
      auction({
        authActive: undefined,
        auction: null,
      }),
    );
    assert.equal(result.stateId, "none");
  });
});
