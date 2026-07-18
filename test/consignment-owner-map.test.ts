import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PonderAuctionAuthorizationRaw } from "../app/actions/auction-agent.ts";
import {
  deriveAuctionConsignment,
  deriveFixedPriceConsignment,
} from "../lib/consignment/lifecycle.ts";
import {
  ownerAuctionAuthToLifecycleInput,
  ownerMarketplaceAuthToLifecycleInput,
} from "../lib/consignment/map-owner-authorization.ts";
import type { PonderAgentAuthorization } from "../lib/types/ponder.ts";

const TOKEN = "123";
const AGENT = "0x1111111111111111111111111111111111111111";
const OWNER = "0x2222222222222222222222222222222222222222";
const NOW = 2_000_000_000;

function marketplaceRow(
  overrides: Partial<PonderAgentAuthorization> = {},
): PonderAgentAuthorization {
  return {
    tokenId: TOKEN,
    agent: AGENT,
    owner: OWNER,
    expiry: String(NOW + 3600),
    ownerMinPrice1e8: "100000000",
    active: true,
    hasActiveListing: false,
    ...overrides,
  };
}

function auctionRow(
  overrides: Partial<PonderAuctionAuthorizationRaw> = {},
): PonderAuctionAuthorizationRaw {
  return {
    tokenId: TOKEN,
    owner: OWNER,
    agent: AGENT,
    expiry: NOW + 3600,
    asset: "",
    ownerMinAsset: "1",
    active: true,
    ...overrides,
  };
}

describe("ownerMarketplaceAuthToLifecycleInput", () => {
  it("maps awaiting authorization to M1", () => {
    const input = ownerMarketplaceAuthToLifecycleInput(
      marketplaceRow(),
      null,
      NOW,
    );
    assert.equal(deriveFixedPriceConsignment(input).stateId, "M1");
  });

  it("maps listed + agent to M2", () => {
    const input = ownerMarketplaceAuthToLifecycleInput(
      marketplaceRow({ hasActiveListing: true }),
      { active: true, agent: AGENT },
      NOW,
    );
    assert.equal(deriveFixedPriceConsignment(input).stateId, "M2");
  });

  it("maps return-requested listing to M2r", () => {
    const input = ownerMarketplaceAuthToLifecycleInput(
      marketplaceRow({ hasActiveListing: true }),
      {
        active: true,
        agent: AGENT,
        returnRequestedAt: BigInt(NOW - 100),
      },
      NOW,
    );
    assert.equal(deriveFixedPriceConsignment(input).stateId, "M2r");
  });

  it("maps expired authorization to M1e", () => {
    const input = ownerMarketplaceAuthToLifecycleInput(
      marketplaceRow({ expiry: String(NOW - 1) }),
      null,
      NOW,
    );
    assert.equal(deriveFixedPriceConsignment(input).stateId, "M1e");
  });
});

describe("ownerAuctionAuthToLifecycleInput", () => {
  it("maps null auction + auth to A1", () => {
    const input = ownerAuctionAuthToLifecycleInput(auctionRow(), null, NOW);
    assert.equal(input.auction, null);
    assert.equal(deriveAuctionConsignment(input).stateId, "A1");
  });

  it("maps S1 auction facts to A2", () => {
    const input = ownerAuctionAuthToLifecycleInput(
      auctionRow(),
      {
        active: true,
        phase: "CREATED",
        startedAt: 0n,
        endsAtChain: 0n,
        returnRequestedAt: 0n,
        passportStatus: "VERIFIED",
      },
      NOW,
    );
    assert.equal(deriveAuctionConsignment(input).stateId, "A2");
  });

  it("never emits unresolved auction undefined from the mapper", () => {
    const input = ownerAuctionAuthToLifecycleInput(auctionRow(), null, NOW);
    assert.notEqual(input.auction, undefined);
  });
});
