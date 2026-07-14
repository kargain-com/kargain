import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseEther, zeroAddress } from "viem";

import {
  auctionReserveMeetsOwnerMin,
  hasAuctionAgent,
  isAuctionAuthExpired,
  isAuctionAuthUsableForCreate,
  parseAuctionAgentAuthorization,
  type AuctionAgentAuth,
} from "../lib/auction/auction-agent.ts";

const AGENT = "0x1111111111111111111111111111111111111111" as `0x${string}`;
const USDC = "0x2222222222222222222222222222222222222222" as `0x${string}`;

function auth(
  overrides: Partial<AuctionAgentAuth> = {},
): AuctionAgentAuth {
  return {
    agent: AGENT,
    expiry: 0n,
    asset: zeroAddress,
    ownerMinAsset: parseEther("1"),
    active: true,
    ...overrides,
  };
}

describe("parseAuctionAgentAuthorization", () => {
  it("parses positional tuple", () => {
    const parsed = parseAuctionAgentAuthorization([
      AGENT,
      1_700_000_000n,
      USDC,
      1_000_000n,
      true,
    ]);
    assert.ok(parsed);
    assert.equal(parsed!.agent.toLowerCase(), AGENT.toLowerCase());
    assert.equal(parsed!.expiry, 1_700_000_000n);
    assert.equal(parsed!.asset.toLowerCase(), USDC.toLowerCase());
    assert.equal(parsed!.ownerMinAsset, 1_000_000n);
    assert.equal(parsed!.active, true);
  });

  it("parses named object", () => {
    const parsed = parseAuctionAgentAuthorization({
      agent: AGENT,
      expiry: 0,
      asset: zeroAddress,
      ownerMinAsset: parseEther("2"),
      active: false,
    });
    assert.ok(parsed);
    assert.equal(parsed!.active, false);
    assert.equal(parsed!.ownerMinAsset, parseEther("2"));
    assert.equal(parsed!.expiry, 0n);
  });

  it("returns null for nullish", () => {
    assert.equal(parseAuctionAgentAuthorization(null), null);
    assert.equal(parseAuctionAgentAuthorization(undefined), null);
  });
});

describe("hasAuctionAgent", () => {
  it("rejects empty and zero address", () => {
    assert.equal(hasAuctionAgent(null), false);
    assert.equal(hasAuctionAgent(""), false);
    assert.equal(hasAuctionAgent(zeroAddress), false);
  });

  it("accepts non-zero address", () => {
    assert.equal(hasAuctionAgent(AGENT), true);
  });
});

describe("expiry", () => {
  it("expiry 0 never expires", () => {
    assert.equal(isAuctionAuthExpired(0n, 2_000_000_000), false);
  });

  it("future expiry is not expired", () => {
    assert.equal(isAuctionAuthExpired(2_000_000_000n, 1_900_000_000), false);
  });

  it("past expiry is expired", () => {
    assert.equal(isAuctionAuthExpired(1_000_000_000n, 1_900_000_000), true);
  });

  it("expired auth is not usable for create but has agent", () => {
    const expired = auth({ expiry: 1_000_000_000n });
    assert.equal(isAuctionAuthUsableForCreate(expired, 2_000_000_000), false);
    assert.equal(hasAuctionAgent(expired.agent), true);
    assert.equal(expired.active, true);
  });

  it("inactive auth is not usable for create", () => {
    assert.equal(
      isAuctionAuthUsableForCreate(auth({ active: false }), 1_000),
      false,
    );
  });

  it("active no-expiry auth is usable", () => {
    assert.equal(isAuctionAuthUsableForCreate(auth(), 1_000), true);
  });
});

describe("auctionReserveMeetsOwnerMin", () => {
  const platformBps = 10n; // 0.1%
  const ownerMin = parseEther("0.9");

  it("passes when net meets owner minimum", () => {
    // 1 ETH reserve, 500 bps agent → agent 0.05, platform 0.001, net 0.949 ≥ 0.9
    assert.equal(
      auctionReserveMeetsOwnerMin(parseEther("1"), 500, platformBps, ownerMin),
      true,
    );
  });

  it("fails when net is below owner minimum", () => {
    // 1 ETH, 2000 bps agent → agent 0.2, platform 0.001, net 0.799 < 0.9
    assert.equal(
      auctionReserveMeetsOwnerMin(parseEther("1"), 2000, platformBps, ownerMin),
      false,
    );
  });

  it("fails for null reserve or platform fee", () => {
    assert.equal(
      auctionReserveMeetsOwnerMin(null, 500, platformBps, ownerMin),
      false,
    );
    assert.equal(
      auctionReserveMeetsOwnerMin(parseEther("1"), 500, null, ownerMin),
      false,
    );
  });

  it("fails when agent fee exceeds max", () => {
    assert.equal(
      auctionReserveMeetsOwnerMin(parseEther("1"), 3001, platformBps, ownerMin),
      false,
    );
  });

  it("passes when net equals owner minimum exactly", () => {
    // reserve R, agentFee=0, platform 0 → net = R
    assert.equal(
      auctionReserveMeetsOwnerMin(ownerMin, 0, 0n, ownerMin),
      true,
    );
  });
});
