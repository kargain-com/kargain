import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CROSSING_TRUST_DISCLOSURE,
  bridgeActionCopy,
  bridgeBlockReasonCopy,
  deriveBridgeDirectionMode,
  deriveBridgeSurface,
  type BridgeSurfaceInput,
  type BridgeSurfaceResult,
} from "../lib/passport/bridge-surface.ts";

const HIDDEN: BridgeSurfaceResult = {
  visible: false,
  mode: "hidden",
  canBridge: false,
  blockReason: null,
};

function input(overrides: Partial<BridgeSurfaceInput> = {}): BridgeSurfaceInput {
  return {
    isOwner: true,
    chainId: 84532,
    mayLeaveChain: true,
    ...overrides,
  };
}

describe("deriveBridgeSurface", () => {
  it("allows bridge when may(LeaveChain) is true", () => {
    assert.deepEqual(deriveBridgeSurface(input()), {
      visible: true,
      mode: "action",
      canBridge: true,
      blockReason: null,
    });
  });

  it("allows bridge on spoke custody (return to hub)", () => {
    assert.deepEqual(deriveBridgeSurface(input({ chainId: 11155111 })), {
      visible: true,
      mode: "action",
      canBridge: true,
      blockReason: null,
    });
  });

  it("hides for non-owner", () => {
    assert.deepEqual(deriveBridgeSurface(input({ isOwner: false })), HIDDEN);
  });

  it("hides on non-star chain", () => {
    assert.deepEqual(deriveBridgeSurface(input({ chainId: 31337 })), HIDDEN);
  });

  it("fail-closes while may(LeaveChain) is unresolved", () => {
    assert.deepEqual(deriveBridgeSurface(input({ mayLeaveChain: undefined })), {
      visible: true,
      mode: "action",
      canBridge: false,
      blockReason: "unresolved",
    });
  });

  it("disables when may refuses leave", () => {
    assert.deepEqual(deriveBridgeSurface(input({ mayLeaveChain: false })), {
      visible: true,
      mode: "action",
      canBridge: false,
      blockReason: "refused",
    });
  });

  it("names consigned when leave is refused and a live consignment is known", () => {
    assert.equal(
      deriveBridgeSurface(
        input({
          mayLeaveChain: false,
          liveConsignmentMode: "fixedPrice",
        }),
      ).blockReason,
      "consigned",
    );
  });

  it("names challenged when leave is refused and a challenge is open", () => {
    assert.equal(
      deriveBridgeSurface(
        input({
          mayLeaveChain: false,
          challengeOpen: true,
        }),
      ).blockReason,
      "challenged",
    );
  });

  it("prefer challenged over consigned for block copy", () => {
    assert.equal(
      deriveBridgeSurface(
        input({
          mayLeaveChain: false,
          liveConsignmentMode: "ascending",
          challengeOpen: true,
        }),
      ).blockReason,
      "challenged",
    );
  });

  it("keeps visible when transitActive even if not owner", () => {
    assert.deepEqual(
      deriveBridgeSurface(input({ isOwner: false, transitActive: true })),
      {
        visible: true,
        mode: "action",
        canBridge: false,
        blockReason: null,
      },
    );
  });

  it("disables canBridge when owner but transitActive", () => {
    assert.deepEqual(deriveBridgeSurface(input({ transitActive: true })), {
      visible: true,
      mode: "action",
      canBridge: false,
      blockReason: null,
    });
  });
});

describe("deriveBridgeDirectionMode", () => {
  it("is move on origin custody and return when away", () => {
    assert.equal(
      deriveBridgeDirectionMode({ custodyChainId: 84532, originChainId: 84532 }),
      "move",
    );
    assert.equal(
      deriveBridgeDirectionMode({
        custodyChainId: 11155111,
        originChainId: 84532,
      }),
      "return",
    );
  });
});

describe("bridgeActionCopy", () => {
  it("labels move vs return", () => {
    assert.match(bridgeActionCopy("move", "Ethereum Sepolia").idleButton, /Move/);
    assert.match(bridgeActionCopy("return", "Base Sepolia").idleButton, /Return/);
  });
});

describe("bridgeBlockReasonCopy", () => {
  it("covers each reason", () => {
    assert.ok(bridgeBlockReasonCopy("consigned"));
    assert.ok(bridgeBlockReasonCopy("challenged"));
    assert.ok(bridgeBlockReasonCopy("refused"));
    assert.ok(bridgeBlockReasonCopy("unresolved"));
  });
});

describe("CROSSING_TRUST_DISCLOSURE", () => {
  it("states that verification does not travel", () => {
    assert.ok(CROSSING_TRUST_DISCLOSURE.length > 40);
    assert.match(CROSSING_TRUST_DISCLOSURE, /Verification does not travel/);
    assert.match(CROSSING_TRUST_DISCLOSURE, /unverified/);
    assert.match(CROSSING_TRUST_DISCLOSURE, /Returning home/);
  });

  it("bridge panel shows disclosure before send", () => {
    const src = readFileSync(
      join(process.cwd(), "components/passport/passport-bridge-panel.tsx"),
      "utf8",
    );
    assert.match(src, /CROSSING_TRUST_DISCLOSURE/);
    assert.match(src, /surface\.canBridge/);
  });
});
