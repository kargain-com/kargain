import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import type { AscendingHoldSnapshot } from "@/lib/commerce/parse-ascending";
import {
  REVERSAL_ABANDONMENT_CONSEQUENCE,
  REVERSAL_NOT_HOLDER_COPY,
  REVERSAL_PENDING_BUYER_BODY,
  REVERSAL_REFUND_CLAIMS_DISCLOSURE,
  RELEASE_FUNDS_CONSEQUENCE,
  deriveAscendingSettlementActions,
  deriveAscendingSettlementState,
  isCompleteReversalActionable,
} from "@/lib/commerce/settlement-state";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SETTLEMENT_PANEL = path.join(
  ROOT,
  "components/auction/auction-settlement-panel.tsx",
);

const BUYER = "0x1111111111111111111111111111111111111111";
const SELLER = "0x2222222222222222222222222222222222222222";
const STRANGER = "0x3333333333333333333333333333333333333333";
const NOW = 1_700_000_000;

function hold(
  overrides: Partial<AscendingHoldSnapshot> = {},
): AscendingHoldSnapshot {
  return {
    buyer: BUYER as `0x${string}`,
    gross: 2_400_000_000_000_000_000n,
    protectionEndsAt: NOW + 7 * 24 * 60 * 60,
    frozenRemaining: 0,
    reversalPending: false,
    abandonmentDeadline: 0,
    abandonmentWindow: 30 * 24 * 60 * 60,
    ...overrides,
  };
}

function reversalHold(
  overrides: Partial<AscendingHoldSnapshot> = {},
): AscendingHoldSnapshot {
  return hold({
    reversalPending: true,
    protectionEndsAt: 0,
    abandonmentDeadline: NOW + 30 * 24 * 60 * 60,
    ...overrides,
  });
}

describe("deriveAscendingSettlementState", () => {
  it("REVERSAL_PENDING before abandonment deadline", () => {
    assert.equal(
      deriveAscendingSettlementState({
        hold: reversalHold(),
        challenge: null,
        nowSec: NOW,
      }),
      "REVERSAL_PENDING",
    );
  });

  it("REVERSAL_EXPIRED at or after abandonment deadline", () => {
    const h = reversalHold({ abandonmentDeadline: NOW });
    assert.equal(
      deriveAscendingSettlementState({
        hold: h,
        challenge: null,
        nowSec: NOW,
      }),
      "REVERSAL_EXPIRED",
    );
  });
});

describe("deriveAscendingSettlementActions — releaseFunds", () => {
  const releasableHold = hold({
    protectionEndsAt: NOW - 1,
    frozenRemaining: 0,
  });

  const base = {
    seller: SELLER,
    agent: null as string | null,
    passportOwner: BUYER,
    modeApproved: true,
  };

  it("stranger on HOLD_RELEASABLE → available (permissionless; no not_party)", () => {
    const state = deriveAscendingSettlementState({
      hold: releasableHold,
      challenge: null,
      nowSec: NOW,
    });
    assert.equal(state, "HOLD_RELEASABLE");

    const actions = deriveAscendingSettlementActions({
      state,
      hold: releasableHold,
      viewer: STRANGER,
      ...base,
    });
    assert.deepEqual(actions.releaseFunds, { status: "available" });
  });

  it("buyer and seller also available when hold is ready", () => {
    for (const viewer of [BUYER, SELLER]) {
      const actions = deriveAscendingSettlementActions({
        state: "HOLD_RELEASABLE",
        hold: releasableHold,
        viewer,
        ...base,
      });
      assert.deepEqual(actions.releaseFunds, { status: "available" });
    }
  });

  it("hold_not_ready while protection is still running", () => {
    const active = hold();
    const state = deriveAscendingSettlementState({
      hold: active,
      challenge: null,
      nowSec: NOW,
    });
    assert.equal(state, "HOLD");
    const actions = deriveAscendingSettlementActions({
      state,
      hold: active,
      viewer: STRANGER,
      ...base,
    });
    assert.deepEqual(actions.releaseFunds, {
      status: "blocked",
      cause: "hold_not_ready",
    });
  });

  it("dispute_active while a challenge is open", () => {
    const actions = deriveAscendingSettlementActions({
      state: "CHALLENGED",
      hold: releasableHold,
      viewer: STRANGER,
      ...base,
    });
    assert.deepEqual(actions.releaseFunds, {
      status: "blocked",
      cause: "dispute_active",
    });
  });

  it("RELEASE_FUNDS_CONSEQUENCE states split parties and gas-only caller", () => {
    assert.match(RELEASE_FUNDS_CONSEQUENCE, /consignment's terms/i);
    assert.match(RELEASE_FUNDS_CONSEQUENCE, /receives nothing/i);
    assert.match(RELEASE_FUNDS_CONSEQUENCE, /gas/i);
  });

  it("settlement panel mounts release disclosure; no not_party", () => {
    const text = fs.readFileSync(SETTLEMENT_PANEL, "utf8");
    assert.match(text, /RELEASE_FUNDS_CONSEQUENCE/);
    assert.doesNotMatch(text, /not_party/);
    const moduleText = fs.readFileSync(
      path.join(ROOT, "lib/commerce/settlement-state.ts"),
      "utf8",
    );
    assert.doesNotMatch(
      moduleText,
      /not_party/,
      "product actor narrowing must be gone",
    );
  });
});

describe("deriveAscendingSettlementActions — completeReversal", () => {
  const base = {
    seller: SELLER,
    agent: null as string | null,
  };

  it("approval-missing: buyer holds passport but mode is not approved → not_approved", () => {
    // Previous behaviour: canCompleteReversal === true with only buyer + pending.
    const state = deriveAscendingSettlementState({
      hold: reversalHold(),
      challenge: null,
      nowSec: NOW,
    });
    assert.equal(state, "REVERSAL_PENDING");

    const actions = deriveAscendingSettlementActions({
      state,
      hold: reversalHold(),
      viewer: BUYER,
      ...base,
      passportOwner: BUYER,
      modeApproved: false,
    });

    assert.deepEqual(actions.completeReversal, {
      status: "blocked",
      cause: "not_approved",
    });
    assert.equal(
      isCompleteReversalActionable(actions.completeReversal),
      true,
      "not_approved remains actionable via approval-then-act",
    );
  });

  it("no-longer-holder: buyer no longer owns the passport → not_holder", () => {
    // Previous behaviour: canCompleteReversal === true with only buyer + pending.
    const state = "REVERSAL_PENDING" as const;
    const actions = deriveAscendingSettlementActions({
      state,
      hold: reversalHold(),
      viewer: BUYER,
      ...base,
      passportOwner: STRANGER,
      modeApproved: true,
    });

    assert.deepEqual(actions.completeReversal, {
      status: "blocked",
      cause: "not_holder",
    });
    assert.equal(
      isCompleteReversalActionable(actions.completeReversal),
      false,
      "not_holder must not offer the return CTA",
    );
  });

  it("available when buyer holds passport and mode is approved", () => {
    const actions = deriveAscendingSettlementActions({
      state: "REVERSAL_PENDING",
      hold: reversalHold(),
      viewer: BUYER,
      ...base,
      passportOwner: BUYER,
      modeApproved: true,
    });
    assert.deepEqual(actions.completeReversal, { status: "available" });
  });

  it("reads_unresolved when owner or approval unread", () => {
    const unreadOwner = deriveAscendingSettlementActions({
      state: "REVERSAL_PENDING",
      hold: reversalHold(),
      viewer: BUYER,
      ...base,
      passportOwner: undefined,
      modeApproved: true,
    });
    assert.deepEqual(unreadOwner.completeReversal, {
      status: "blocked",
      cause: "reads_unresolved",
    });

    const unreadApproval = deriveAscendingSettlementActions({
      state: "REVERSAL_PENDING",
      hold: reversalHold(),
      viewer: BUYER,
      ...base,
      passportOwner: BUYER,
      modeApproved: undefined,
    });
    assert.deepEqual(unreadApproval.completeReversal, {
      status: "blocked",
      cause: "reads_unresolved",
    });
  });

  it("not_buyer when viewer is not the hold buyer", () => {
    const actions = deriveAscendingSettlementActions({
      state: "REVERSAL_PENDING",
      hold: reversalHold(),
      viewer: SELLER,
      ...base,
      passportOwner: BUYER,
      modeApproved: true,
    });
    assert.deepEqual(actions.completeReversal, {
      status: "blocked",
      cause: "not_buyer",
    });
  });
});

describe("reversal-pending copy — deadline visible contract", () => {
  it("buyer body separates bond return from settled-amount refund", () => {
    assert.match(REVERSAL_PENDING_BUYER_BODY, /bond was returned/i);
    assert.match(REVERSAL_PENDING_BUYER_BODY, /challenge was judged/i);
    assert.match(REVERSAL_PENDING_BUYER_BODY, /settled amount/i);
    assert.doesNotMatch(
      REVERSAL_PENDING_BUYER_BODY,
      /sale amount plus bond/i,
      "must not imply bond and settled amount arrive together",
    );
  });

  it("claims disclosure and abandonment consequence are stated", () => {
    assert.match(REVERSAL_REFUND_CLAIMS_DISCLOSURE, /Claims/);
    assert.match(
      REVERSAL_ABANDONMENT_CONSEQUENCE,
      /seller is paid as though the challenge had failed/i,
    );
    assert.match(REVERSAL_NOT_HOLDER_COPY, /no longer holds the passport/i);
    assert.match(REVERSAL_NOT_HOLDER_COPY, /abandonment deadline/i);
  });

  it("settlement panel imports deadline copy and renders abandonment readout", () => {
    const text = fs.readFileSync(SETTLEMENT_PANEL, "utf8");
    assert.match(
      text,
      /REVERSAL_ABANDONMENT_CONSEQUENCE/,
      "panel must surface abandonment consequence with the deadline",
    );
    assert.match(text, /REVERSAL_PENDING_BUYER_BODY/);
    assert.match(text, /REVERSAL_REFUND_CLAIMS_DISCLOSURE/);
    assert.match(text, /REVERSAL_NOT_HOLDER_COPY/);
    assert.match(
      text,
      /abandonmentDeadline/,
      "panel must read hold.abandonmentDeadline for the countdown",
    );
    assert.match(text, /Return by/);
    assert.match(text, /usePassportApproval/);
    assert.match(text, /ensureApproved/);
  });

  // Passport ERC-721 approval choke-point: test/passport-approval-policy.test.ts (test:verify).
});
