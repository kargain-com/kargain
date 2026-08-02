import {
  type ChallengeSnapshot,
  deriveChallengePhase,
} from "@/lib/challenge";
import { addressesMatch } from "@/lib/commerce/consignment";
import type { AscendingHoldSnapshot } from "@/lib/commerce/parse-ascending";

/**
 * Ascending settlement lifecycle after `settle`:
 * HOLD → (challenge) CHALLENGED → judgement → RELEASABLE → released,
 * or reversal started → REVERSAL_PENDING → completed / abandoned.
 */
export type AscendingSettlementState =
  | "NONE"
  | "HOLD"
  | "HOLD_RELEASABLE"
  | "CHALLENGED"
  | "CHALLENGE_ELAPSED"
  /** Challenge open but window/openedAt unreadable — no timed transition. */
  | "CHALLENGE_UNRESOLVED"
  | "REVERSAL_PENDING"
  | "REVERSAL_EXPIRED";

export type DeriveAscendingSettlementInput = {
  readonly hold: AscendingHoldSnapshot | null;
  readonly challenge: ChallengeSnapshot | null;
  readonly nowSec: number;
};

/**
 * Precedence: reversal → challenge → protection countdown.
 * A frozen protection remainder (set when a challenge opens) keeps the hold in
 * `CHALLENGED` rather than letting the clock run out underneath the challenge.
 * Phase comes only from `deriveChallengePhase` (fail closed).
 */
export function deriveAscendingSettlementState(
  input: DeriveAscendingSettlementInput,
): AscendingSettlementState {
  const { hold, challenge, nowSec } = input;
  if (!hold) return "NONE";

  if (hold.reversalPending) {
    if (hold.abandonmentDeadline > 0 && nowSec >= hold.abandonmentDeadline) {
      return "REVERSAL_EXPIRED";
    }
    return "REVERSAL_PENDING";
  }

  if (challenge) {
    const phase = deriveChallengePhase({
      openedAt: challenge.openedAt,
      windowDuration: challenge.windowDuration,
      nowSec,
    });
    if (phase.unresolved) return "CHALLENGE_UNRESOLVED";
    return phase.phase === "active" ? "CHALLENGED" : "CHALLENGE_ELAPSED";
  }

  if (hold.frozenRemaining > 0) return "HOLD";
  if (hold.protectionEndsAt > 0 && nowSec >= hold.protectionEndsAt) {
    return "HOLD_RELEASABLE";
  }
  return "HOLD";
}

/** Live countdowns that need a 15s refetch while the panel is mounted. */
export function isAscendingSettlementPollActive(
  state: AscendingSettlementState,
): boolean {
  return (
    state === "HOLD" ||
    state === "CHALLENGED" ||
    state === "CHALLENGE_UNRESOLVED" ||
    state === "REVERSAL_PENDING"
  );
}

/** Available, or blocked with a named cause mirroring the entry-point guards. */
export type SettlementActionGate<C extends string> =
  | { readonly status: "available" }
  | { readonly status: "blocked"; readonly cause: C };

export type ConfirmReceiptBlockCause =
  | "no_hold"
  | "not_buyer"
  | "wrong_state"
  | "dispute_active"
  | "reversal_pending";

export type ReleaseFundsBlockCause =
  | "no_hold"
  | "wrong_state"
  | "dispute_active"
  | "reversal_pending"
  | "hold_not_ready";

export type CompleteReversalBlockCause =
  | "no_hold"
  | "no_reversal_pending"
  | "not_buyer"
  | "not_holder"
  | "not_approved"
  | "reads_unresolved";

export type AbandonReversalBlockCause =
  | "no_hold"
  | "no_reversal_pending"
  | "abandonment_not_ready";

export type AscendingSettlementActions = {
  readonly confirmReceipt: SettlementActionGate<ConfirmReceiptBlockCause>;
  readonly releaseFunds: SettlementActionGate<ReleaseFundsBlockCause>;
  readonly completeReversal: SettlementActionGate<CompleteReversalBlockCause>;
  readonly abandonReversal: SettlementActionGate<AbandonReversalBlockCause>;
};

const BLOCKED = {
  confirm: (cause: ConfirmReceiptBlockCause) =>
    ({ status: "blocked", cause }) as const,
  release: (cause: ReleaseFundsBlockCause) =>
    ({ status: "blocked", cause }) as const,
  complete: (cause: CompleteReversalBlockCause) =>
    ({ status: "blocked", cause }) as const,
  abandon: (cause: AbandonReversalBlockCause) =>
    ({ status: "blocked", cause }) as const,
} as const;

const AVAILABLE = { status: "available" } as const;

/**
 * Buyer confirms receipt (early release) or completes a started reversal;
 * anyone releases once protection lapses (permissionless on chain — caller
 * pays gas, split pays the consignment parties); anyone clears an expired
 * reversal so the lot stops blocking the passport.
 *
 * Every action is available or blocked with a named cause covering the
 * contract entry-point preconditions (plus fail-closed unread reads for
 * completeReversal).
 */
export function deriveAscendingSettlementActions(input: {
  state: AscendingSettlementState;
  hold: AscendingHoldSnapshot | null;
  viewer: string | null | undefined;
  seller: string | null | undefined;
  agent: string | null | undefined;
  /**
   * Current `ownerOf(tokenId)` on the passport. `undefined` = unread;
   * `null` = read failed / nonexistent.
   */
  passportOwner: string | null | undefined;
  /**
   * Mode approved over this token (token approve or operator-for-all).
   * `undefined` = unread.
   */
  modeApproved: boolean | undefined;
}): AscendingSettlementActions {
  const {
    state,
    hold,
    viewer,
    passportOwner,
    modeApproved,
  } = input;

  if (!hold) {
    return {
      confirmReceipt: BLOCKED.confirm("no_hold"),
      releaseFunds: BLOCKED.release("no_hold"),
      completeReversal: BLOCKED.complete("no_hold"),
      abandonReversal: BLOCKED.abandon("no_hold"),
    };
  }

  const isBuyer = Boolean(viewer && addressesMatch(hold.buyer, viewer));
  const challengeOpen =
    state === "CHALLENGED" ||
    state === "CHALLENGE_ELAPSED" ||
    state === "CHALLENGE_UNRESOLVED";

  let confirmReceipt: SettlementActionGate<ConfirmReceiptBlockCause>;
  if (!viewer || !isBuyer) {
    confirmReceipt = BLOCKED.confirm("not_buyer");
  } else if (hold.reversalPending) {
    confirmReceipt = BLOCKED.confirm("reversal_pending");
  } else if (challengeOpen) {
    confirmReceipt = BLOCKED.confirm("dispute_active");
  } else if (state !== "HOLD") {
    confirmReceipt = BLOCKED.confirm("wrong_state");
  } else {
    confirmReceipt = AVAILABLE;
  }

  // Permissionless once ready — mirrors clearHoldForRelease (no caller check).
  let releaseFunds: SettlementActionGate<ReleaseFundsBlockCause>;
  if (hold.reversalPending) {
    releaseFunds = BLOCKED.release("reversal_pending");
  } else if (challengeOpen) {
    releaseFunds = BLOCKED.release("dispute_active");
  } else if (state === "HOLD") {
    releaseFunds = BLOCKED.release("hold_not_ready");
  } else if (state !== "HOLD_RELEASABLE") {
    releaseFunds = BLOCKED.release("wrong_state");
  } else {
    releaseFunds = AVAILABLE;
  }

  let completeReversal: SettlementActionGate<CompleteReversalBlockCause>;
  if (!hold.reversalPending || state === "REVERSAL_EXPIRED") {
    completeReversal = BLOCKED.complete("no_reversal_pending");
  } else if (!viewer || !isBuyer) {
    completeReversal = BLOCKED.complete("not_buyer");
  } else if (passportOwner === undefined || modeApproved === undefined) {
    completeReversal = BLOCKED.complete("reads_unresolved");
  } else if (
    passportOwner == null ||
    !addressesMatch(passportOwner, hold.buyer)
  ) {
    completeReversal = BLOCKED.complete("not_holder");
  } else if (!modeApproved) {
    completeReversal = BLOCKED.complete("not_approved");
  } else {
    completeReversal = AVAILABLE;
  }

  let abandonReversal: SettlementActionGate<AbandonReversalBlockCause>;
  if (!hold.reversalPending) {
    abandonReversal = BLOCKED.abandon("no_reversal_pending");
  } else if (state === "REVERSAL_PENDING") {
    abandonReversal = BLOCKED.abandon("abandonment_not_ready");
  } else if (state === "REVERSAL_EXPIRED") {
    abandonReversal = AVAILABLE;
  } else {
    abandonReversal = BLOCKED.abandon("no_reversal_pending");
  }

  return {
    confirmReceipt,
    releaseFunds,
    completeReversal,
    abandonReversal,
  };
}

/** Whether the complete-reversal CTA should be offered (ready or needs approval). */
export function isCompleteReversalActionable(
  gate: SettlementActionGate<CompleteReversalBlockCause>,
): boolean {
  return (
    gate.status === "available" ||
    (gate.status === "blocked" && gate.cause === "not_approved")
  );
}

export function ascendingSettlementCopy(state: AscendingSettlementState): string {
  switch (state) {
    case "HOLD":
      return "Funds are held while the buyer inspects the vehicle.";
    case "HOLD_RELEASABLE":
      return "The protection window has passed. Anyone can release the funds.";
    case "CHALLENGED":
      return "A bonded challenge is open. The protection clock is frozen.";
    case "CHALLENGE_ELAPSED":
      return "The challenge window has passed without a judgement. Anyone can conclude it.";
    case "CHALLENGE_UNRESOLVED":
      return "A bonded challenge is open. Challenge window details are still loading.";
    case "REVERSAL_PENDING":
      return "A reversal is in progress. The buyer must return the passport.";
    case "REVERSAL_EXPIRED":
      return "The reversal deadline has passed and can be abandoned.";
    default:
      return "";
  }
}

/** Buyer-facing body while reversal is pending — two money moments. */
export const REVERSAL_PENDING_BUYER_BODY =
  "Your challenge was upheld. The bond was returned when the challenge was judged. Return the passport to receive the settled amount.";

/** Claims fallback for the reversal refund (same rule as passport dispute terminals). */
export const REVERSAL_REFUND_CLAIMS_DISCLOSURE =
  "If the refund cannot be delivered, it waits under Claims.";

/**
 * Abandonment consequence — shown with the deadline while reversal is pending
 * (and remains true after expiry).
 */
export const REVERSAL_ABANDONMENT_CONSEQUENCE =
  "If you miss it, anyone can abandon the reversal and the seller is paid as though the challenge had failed.";

/**
 * Permissionless release — funds follow the consignment split; the caller
 * receives nothing and pays gas (model §4.3 / clearHoldForRelease).
 */
export const RELEASE_FUNDS_CONSEQUENCE =
  "Funds go to the parties on the consignment's terms. The caller receives nothing and pays only gas.";

/** CH6 — buyer no longer holds the passport. */
export const REVERSAL_NOT_HOLDER_COPY =
  "Reversal is no longer possible. This wallet no longer holds the passport, so the mode cannot pull it back. When the abandonment deadline passes, the seller can be paid as though the challenge had failed.";
