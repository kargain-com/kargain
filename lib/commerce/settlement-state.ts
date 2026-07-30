import {
  type ChallengeSnapshot,
  challengeWindowPhase,
} from "@/lib/commerce/challenge";
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
    return challengeWindowPhase(challenge, nowSec) === "active"
      ? "CHALLENGED"
      : "CHALLENGE_ELAPSED";
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
  return state === "HOLD" || state === "CHALLENGED" || state === "REVERSAL_PENDING";
}

export type AscendingSettlementActions = {
  readonly canConfirmReceipt: boolean;
  readonly canReleaseFunds: boolean;
  readonly canCompleteReversal: boolean;
  readonly canAbandonReversal: boolean;
};

/**
 * Buyer confirms receipt (early release) or completes a started reversal; the
 * seller/agent releases once protection lapses; anyone clears an expired
 * reversal so the lot stops blocking the passport.
 */
export function deriveAscendingSettlementActions(input: {
  state: AscendingSettlementState;
  hold: AscendingHoldSnapshot | null;
  viewer: string | null | undefined;
  seller: string | null | undefined;
  agent: string | null | undefined;
}): AscendingSettlementActions {
  const { state, hold, viewer, seller, agent } = input;
  const none: AscendingSettlementActions = {
    canConfirmReceipt: false,
    canReleaseFunds: false,
    canCompleteReversal: false,
    canAbandonReversal: false,
  };
  if (!hold || !viewer) return none;

  const isBuyer = addressesMatch(hold.buyer, viewer);
  const isSellerSide =
    addressesMatch(seller, viewer) || addressesMatch(agent, viewer);

  return {
    canConfirmReceipt: isBuyer && state === "HOLD",
    canReleaseFunds:
      (isBuyer || isSellerSide) && state === "HOLD_RELEASABLE",
    canCompleteReversal: isBuyer && state === "REVERSAL_PENDING",
    canAbandonReversal: state === "REVERSAL_EXPIRED",
  };
}

export function ascendingSettlementCopy(state: AscendingSettlementState): string {
  switch (state) {
    case "HOLD":
      return "Funds are held while the buyer inspects the vehicle.";
    case "HOLD_RELEASABLE":
      return "The protection window has passed. Funds can be released.";
    case "CHALLENGED":
      return "A bonded challenge is open. The protection clock is frozen.";
    case "CHALLENGE_ELAPSED":
      return "The challenge window has passed without a judgement. Anyone can conclude it.";
    case "REVERSAL_PENDING":
      return "A reversal is in progress. The buyer must return the passport.";
    case "REVERSAL_EXPIRED":
      return "The reversal deadline has passed and can be abandoned.";
    default:
      return "";
  }
}
