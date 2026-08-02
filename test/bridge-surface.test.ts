import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { EncumbrancePermissionGate } from "../lib/passport/encumbrance-permission.ts";
import {
  CROSSING_TRUST_DISCLOSURE,
  CROSSING_UNVERIFIED_DISCLOSURE,
  bridgeActionCopy,
  bridgeBlockReasonCopy,
  deriveBridgeCrossingConsent,
  deriveBridgeDirectionMode,
  deriveBridgeSurface,
  type BridgeSurfaceInput,
  type BridgeSurfaceResult,
} from "../lib/passport/bridge-surface.ts";

const AVAILABLE: EncumbrancePermissionGate = { status: "available" };
const REFUSED: EncumbrancePermissionGate = {
  status: "blocked",
  cause: "refused",
};
const UNRESOLVED: EncumbrancePermissionGate = {
  status: "blocked",
  cause: "reads_unresolved",
};
const SOURCE = "0x1111111111111111111111111111111111111111" as const;
const UNANSWERABLE: EncumbrancePermissionGate = {
  status: "blocked",
  cause: "source_unanswerable",
  source: SOURCE,
};

const HIDDEN: BridgeSurfaceResult = {
  visible: false,
  mode: "hidden",
  canBridge: false,
  blockReason: null,
  unanswerableSource: null,
};

function input(overrides: Partial<BridgeSurfaceInput> = {}): BridgeSurfaceInput {
  return {
    isOwner: true,
    chainId: 84532,
    leaveChainPermission: AVAILABLE,
    ...overrides,
  };
}

describe("deriveBridgeSurface", () => {
  it("allows bridge when may(LeaveChain) is available", () => {
    assert.deepEqual(deriveBridgeSurface(input()), {
      visible: true,
      mode: "action",
      canBridge: true,
      blockReason: null,
      unanswerableSource: null,
    });
  });

  it("allows bridge on spoke custody (return to hub)", () => {
    assert.deepEqual(deriveBridgeSurface(input({ chainId: 11155111 })), {
      visible: true,
      mode: "action",
      canBridge: true,
      blockReason: null,
      unanswerableSource: null,
    });
  });

  it("hides for non-owner", () => {
    assert.deepEqual(deriveBridgeSurface(input({ isOwner: false })), HIDDEN);
  });

  it("hides on non-star chain", () => {
    assert.deepEqual(deriveBridgeSurface(input({ chainId: 31337 })), HIDDEN);
  });

  it("fail-closes while may(LeaveChain) is unresolved", () => {
    assert.deepEqual(
      deriveBridgeSurface(input({ leaveChainPermission: UNRESOLVED })),
      {
        visible: true,
        mode: "action",
        canBridge: false,
        blockReason: "unresolved",
        unanswerableSource: null,
      },
    );
  });

  it("disables when may refuses leave", () => {
    assert.deepEqual(
      deriveBridgeSurface(input({ leaveChainPermission: REFUSED })),
      {
        visible: true,
        mode: "action",
        canBridge: false,
        blockReason: "refused",
        unanswerableSource: null,
      },
    );
  });

  it("names the unanswerable source on SourceUnanswerable", () => {
    assert.deepEqual(
      deriveBridgeSurface(input({ leaveChainPermission: UNANSWERABLE })),
      {
        visible: true,
        mode: "action",
        canBridge: false,
        blockReason: "source_unanswerable",
        unanswerableSource: SOURCE,
      },
    );
  });

  it("names consigned when leave is refused and a live consignment is known", () => {
    assert.equal(
      deriveBridgeSurface(
        input({
          leaveChainPermission: REFUSED,
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
          leaveChainPermission: REFUSED,
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
          leaveChainPermission: REFUSED,
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
        unanswerableSource: null,
      },
    );
  });

  it("disables canBridge when owner but transitActive", () => {
    assert.deepEqual(deriveBridgeSurface(input({ transitActive: true })), {
      visible: true,
      mode: "action",
      canBridge: false,
      blockReason: null,
      unanswerableSource: null,
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
    assert.match(
      bridgeBlockReasonCopy("source_unanswerable", SOURCE),
      /0x1111/,
    );
  });
});

describe("CROSSING_TRUST_DISCLOSURE", () => {
  it("states that verification does not travel", () => {
    assert.ok(CROSSING_TRUST_DISCLOSURE.length > 40);
    assert.match(CROSSING_TRUST_DISCLOSURE, /Verification does not travel/);
    assert.match(CROSSING_TRUST_DISCLOSURE, /unverified/);
    assert.match(CROSSING_TRUST_DISCLOSURE, /Returning home/);
    assert.match(CROSSING_TRUST_DISCLOSURE, /fixed price/i);
  });

  it("bridge panel wires crossing consent before send", () => {
    const src = readFileSync(
      join(process.cwd(), "components/passport/passport-bridge-panel.tsx"),
      "utf8",
    );
    assert.match(src, /deriveBridgeCrossingConsent/);
    assert.match(src, /crossingConsent/);
    assert.match(src, /requiresAck/);
    assert.match(src, /surface\.canBridge/);
  });
});

describe("deriveBridgeCrossingConsent", () => {
  it("requires ack with full disclosure when VERIFIED", () => {
    assert.deepEqual(deriveBridgeCrossingConsent("VERIFIED"), {
      disclosure: CROSSING_TRUST_DISCLOSURE,
      requiresAck: true,
    });
  });

  it("uses short disclosure without ack when not VERIFIED", () => {
    assert.deepEqual(deriveBridgeCrossingConsent("UNVERIFIED"), {
      disclosure: CROSSING_UNVERIFIED_DISCLOSURE,
      requiresAck: false,
    });
    assert.deepEqual(deriveBridgeCrossingConsent("DISPUTED"), {
      disclosure: CROSSING_UNVERIFIED_DISCLOSURE,
      requiresAck: false,
    });
    assert.deepEqual(deriveBridgeCrossingConsent(undefined), {
      disclosure: CROSSING_UNVERIFIED_DISCLOSURE,
      requiresAck: false,
    });
    assert.doesNotMatch(CROSSING_UNVERIFIED_DISCLOSURE, /Returning home/);
  });
});
