import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SmokeBridgePolicyError,
  assertSmokeBridgeAllowed,
  isSmokeBridgeMainnetChainId,
} from "../scripts/lib/smoke-bridge-policy.ts";

describe("isSmokeBridgeMainnetChainId", () => {
  it("flags planned mainnets from SPEC I.9", () => {
    assert.equal(isSmokeBridgeMainnetChainId(1), true);
    assert.equal(isSmokeBridgeMainnetChainId(8453), true);
    assert.equal(isSmokeBridgeMainnetChainId(137), true);
  });

  it("allows testnets", () => {
    assert.equal(isSmokeBridgeMainnetChainId(84532), false);
    assert.equal(isSmokeBridgeMainnetChainId(11155111), false);
    assert.equal(isSmokeBridgeMainnetChainId(31337), false);
  });
});

describe("assertSmokeBridgeAllowed", () => {
  it("accepts testnet hub with tokenId", () => {
    assert.doesNotThrow(() =>
      assertSmokeBridgeAllowed({ hubChainId: 84532, tokenId: 1n }),
    );
  });

  it("refuses missing tokenId on testnet", () => {
    assert.throws(
      () => assertSmokeBridgeAllowed({ hubChainId: 84532, tokenId: null }),
      (err: unknown) =>
        err instanceof SmokeBridgePolicyError &&
        /Missing --token-id/.test(err.message),
    );
  });

  it("refuses mainnet even with tokenId", () => {
    assert.throws(
      () => assertSmokeBridgeAllowed({ hubChainId: 8453, tokenId: 1n }),
      (err: unknown) =>
        err instanceof SmokeBridgePolicyError &&
        /forbidden on mainnet/.test(err.message),
    );
  });
});
