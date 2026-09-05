import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CUSTODY_UNRESOLVED_CAUSES } from "../lib/custody/normalized-event.ts";
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
import {
  locationUnresolvedCauseCopy,
  passportAwayActionCopy,
} from "../lib/passport/presence.ts";

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
  location: null,
  locationCopy: null,
};

/** Happy-path facts: lock read answered unlocked — never invent this in product without a read. */
function input(overrides: Partial<BridgeSurfaceInput> = {}): BridgeSurfaceInput {
  return {
    isOwner: true,
    chainId: 84532,
    leaveChainPermission: AVAILABLE,
    custodyLocked: false,
    ponderCustodyChain: 84532,
    ...overrides,
  };
}

function hereLoc() {
  return {
    location: { status: "here" as const },
    locationCopy: null as string | null,
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
      ...hereLoc(),
    });
  });

  it("allows bridge on spoke custody (return to hub)", () => {
    assert.deepEqual(
      deriveBridgeSurface(
        input({ chainId: 11155111, ponderCustodyChain: 11155111 }),
      ),
      {
        visible: true,
        mode: "action",
        canBridge: true,
        blockReason: null,
        unanswerableSource: null,
        ...hereLoc(),
      },
    );
  });

  it("hides for non-owner", () => {
    assert.deepEqual(deriveBridgeSurface(input({ isOwner: false })), HIDDEN);
  });

  it("hides on non-star chain", () => {
    assert.deepEqual(deriveBridgeSurface(input({ chainId: 31337 })), HIDDEN);
  });

  it("fail-closes while may(LeaveChain) is unresolved", () => {
    const surface = deriveBridgeSurface(
      input({ leaveChainPermission: UNRESOLVED }),
    );
    assert.equal(surface.canBridge, false);
    assert.equal(surface.blockReason, "unresolved");
    assert.equal(surface.locationCopy, null);
    assert.match(bridgeBlockReasonCopy(surface.blockReason!), /Waiting for chain permission/);
  });

  it("disables when may refuses leave", () => {
    const surface = deriveBridgeSurface(
      input({ leaveChainPermission: REFUSED }),
    );
    assert.equal(surface.blockReason, "refused");
    assert.equal(surface.canBridge, false);
  });

  it("names the unanswerable source on SourceUnanswerable", () => {
    const surface = deriveBridgeSurface(
      input({ leaveChainPermission: UNANSWERABLE }),
    );
    assert.equal(surface.blockReason, "source_unanswerable");
    assert.equal(surface.unanswerableSource, SOURCE);
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
    const surface = deriveBridgeSurface(
      input({ isOwner: false, transitActive: true }),
    );
    assert.equal(surface.visible, true);
    assert.equal(surface.canBridge, false);
    assert.equal(surface.blockReason, null);
  });

  it("disables canBridge when owner but transitActive", () => {
    const surface = deriveBridgeSurface(input({ transitActive: true }));
    assert.equal(surface.canBridge, false);
    assert.equal(surface.blockReason, null);
  });

  it("keeps transit chrome without leave permission when the page has no commerce chain", () => {
    const surface = deriveBridgeSurface({
      isOwner: false,
      chainId: 84532,
      transitActive: true,
      custodyUnresolved: "departure_without_arrival",
    });
    assert.equal(surface.visible, true);
    assert.equal(surface.canBridge, false);
    assert.equal(surface.blockReason, null);
    assert.equal(surface.location?.status, "location_unresolved");
  });

  it("negative control: without commerce chain or transit, bridge stays hidden", () => {
    const surface = deriveBridgeSurface({
      isOwner: true,
      chainId: 84532,
      custodyLocked: false,
      ponderCustodyChain: 84532,
    });
    assert.equal(surface.visible, false);
  });
});

describe("deriveBridgeSurface — fold vs leave unread", () => {
  it("each fold cause yields §4.21 locationCopy and never leave-unread blockReason", () => {
    for (const cause of CUSTODY_UNRESOLVED_CAUSES) {
      const surface = deriveBridgeSurface(
        input({
          leaveChainPermission: AVAILABLE,
          custodyUnresolved: cause,
          custodyLocked: false,
        }),
      );
      assert.equal(surface.canBridge, false, cause);
      assert.equal(surface.blockReason, null, cause);
      assert.equal(surface.location?.status, "location_unresolved", cause);
      const expected = locationUnresolvedCauseCopy(cause);
      assert.equal(surface.locationCopy, expected, cause);
      assert.doesNotMatch(surface.locationCopy ?? "", /Waiting for chain permission/);
      assert.doesNotMatch(surface.locationCopy ?? "", /leave permission/i);
    }
  });

  it("negative control: fold must not be reported as leave-unread unresolved", () => {
    const surface = deriveBridgeSurface(
      input({
        leaveChainPermission: AVAILABLE,
        custodyUnresolved: "empty_history",
      }),
    );
    // Perturbation that would pass under the old dual-path lie:
    assert.notEqual(surface.blockReason, "unresolved");
    assert.notEqual(
      surface.locationCopy,
      bridgeBlockReasonCopy("unresolved"),
    );
  });

  it("lock unread is locationCopy, not leave-permission unresolved", () => {
    const surface = deriveBridgeSurface(
      input({
        leaveChainPermission: AVAILABLE,
        custodyLocked: undefined,
        custodyUnresolved: null,
      }),
    );
    assert.equal(surface.canBridge, false);
    assert.equal(surface.blockReason, null);
    assert.equal(surface.location?.status, "location_unread");
    assert.equal(
      surface.locationCopy,
      passportAwayActionCopy({ status: "location_unread" }),
    );
  });
});

describe("bridge panel consumes surface location — derives nothing", () => {
  it("panel has no derivePassportPresence and uses surface.locationCopy", () => {
    const src = readFileSync(
      join(process.cwd(), "components/passport/passport-bridge-panel.tsx"),
      "utf8",
    );
    assert.doesNotMatch(src, /derivePassportPresence/);
    assert.doesNotMatch(src, /passportAwayActionCopy/);
    assert.match(src, /surface\.locationCopy/);
    assert.match(src, /custodyUnresolved/);
    const locationFirst = src.indexOf("surface.locationCopy != null");
    const blockReason = src.indexOf("surface.blockReason != null");
    assert.ok(locationFirst > 0 && blockReason > locationFirst);
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

  it("encumbrance unread keeps leave-permission wording (not fold)", () => {
    const copy = bridgeBlockReasonCopy("unresolved");
    assert.match(copy, /Waiting for chain permission/);
    assert.doesNotMatch(copy, /No custody events/);
    assert.doesNotMatch(copy, /one side only/);
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
