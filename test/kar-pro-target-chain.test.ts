import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  resolveKarProTargetChainId,
  shouldShowBecomeKarPro,
} from "../lib/kar-pro/kar-pro-target-chain.ts";
import { isCommercialChainId } from "../lib/web3/commercial-active.ts";

describe("isCommercialChainId", () => {
  it("accepts hub and spoke", () => {
    assert.equal(isCommercialChainId(84532), true);
    assert.equal(isCommercialChainId(11155111), true);
  });

  it("rejects unknown and mainnet", () => {
    assert.equal(isCommercialChainId(1), false);
    assert.equal(isCommercialChainId(31337), false);
  });
});

describe("resolveKarProTargetChainId", () => {
  it("returns commercial wallet chain ids", () => {
    assert.equal(resolveKarProTargetChainId(84532), 84532);
    assert.equal(resolveKarProTargetChainId(11155111), 11155111);
  });

  it("returns null for missing or non-commercial", () => {
    assert.equal(resolveKarProTargetChainId(undefined), null);
    assert.equal(resolveKarProTargetChainId(1), null);
    assert.equal(resolveKarProTargetChainId(Number.NaN), null);
  });
});

describe("shouldShowBecomeKarPro", () => {
  it("shows when connected and not active on target", () => {
    assert.equal(
      shouldShowBecomeKarPro({ isConnected: true, isActiveOnTarget: false }),
      true,
    );
  });

  it("hides when active on target", () => {
    assert.equal(
      shouldShowBecomeKarPro({ isConnected: true, isActiveOnTarget: true }),
      false,
    );
  });

  it("hides when disconnected", () => {
    assert.equal(
      shouldShowBecomeKarPro({ isConnected: false, isActiveOnTarget: false }),
      false,
    );
  });
});
