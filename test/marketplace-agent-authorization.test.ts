import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { zeroAddress } from "viem";

import { parseMarketplaceAgentAuthorization } from "../lib/marketplace/agent-authorization.ts";

const AGENT = "0xcfe194fea9727bD04dA8F78c2362680986e02dF1" as const;

describe("parseMarketplaceAgentAuthorization", () => {
  it("parses the exact positional array returned by viem", () => {
    const decoded = [
      AGENT,
      1_700_000_000n,
      42_000_000_000n,
      true,
    ] as const;

    const parsed = parseMarketplaceAgentAuthorization(decoded);

    assert.ok(parsed);
    assert.equal(parsed.agent, AGENT);
    assert.equal(parsed.expiry, 1_700_000_000n);
    assert.equal(parsed.ownerMinPrice1e8, 42_000_000_000n);
    assert.equal(parsed.active, true);
  });

  it("parses named object output", () => {
    const parsed = parseMarketplaceAgentAuthorization({
      agent: AGENT,
      expiry: 0,
      ownerMinPrice1e8: "150000000",
      active: true,
    });

    assert.ok(parsed);
    assert.equal(parsed.expiry, 0n);
    assert.equal(parsed.ownerMinPrice1e8, 150_000_000n);
    assert.equal(parsed.active, true);
  });

  it("preserves inactive authorization rows", () => {
    const parsed = parseMarketplaceAgentAuthorization([
      AGENT,
      0n,
      0n,
      false,
    ]);

    assert.ok(parsed);
    assert.equal(parsed.active, false);
  });

  it("maps zero and invalid agent addresses to the zero address", () => {
    const zeroAgent = parseMarketplaceAgentAuthorization([
      zeroAddress,
      0n,
      0n,
      true,
    ]);
    const invalidAgent = parseMarketplaceAgentAuthorization({
      agent: "not-an-address",
      expiry: 0n,
      ownerMinPrice1e8: 0n,
      active: true,
    });

    assert.equal(zeroAgent?.agent, zeroAddress);
    assert.equal(invalidAgent?.agent, zeroAddress);
  });

  it("returns null for malformed shapes", () => {
    assert.equal(parseMarketplaceAgentAuthorization(null), null);
    assert.equal(parseMarketplaceAgentAuthorization("active"), null);
    assert.equal(
      parseMarketplaceAgentAuthorization([AGENT, 0n, 0n]),
      null,
    );
    assert.equal(
      parseMarketplaceAgentAuthorization({ active: true }),
      null,
    );
  });
});
