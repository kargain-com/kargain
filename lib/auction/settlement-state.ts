import type { AuctionSettlement } from "@/lib/auction/map-ponder-auction";
import type { OnChainHold } from "@/lib/auction/parse-on-chain-auction";

export type SettlementUiState =
  | "HOLD"
  | "HOLD_RELEASABLE"
  | "DISPUTED"
  | "DISPUTE_TIMED_OUT"
  | "REFUND_PENDING"
  | "RELEASED"
  | "CLEARED"
  | "NONE";

export type DeriveSettlementUiStateInput = {
  settlement: AuctionSettlement | null;
  hold: OnChainHold | null;
  /** Unix seconds. */
  nowSec: number | bigint;
  /** Chain `disputeResolutionTimeout` in seconds. */
  disputeResolutionTimeoutSec: number | bigint;
};

/** Effective hold timestamps — chain wins when a hold is open. */
export type SettlementHoldSnapshot = {
  buyer: string;
  gross: bigint;
  releaseAt: bigint;
  disputedAt: bigint;
  bond: bigint;
  refundPendingAt: bigint;
  clearedAt: bigint | null;
  releasedAt: bigint | null;
  receiptConfirmedAt: bigint | null;
  platformFee: bigint;
  agentFee: bigint;
  net: bigint;
  disputeOutcome: string;
  autoRelease: boolean;
};

function asSec(value: number | bigint): bigint {
  return typeof value === "bigint" ? value : BigInt(Math.floor(value));
}

/**
 * Merge Ponder settlement + chain holds for UI derivation.
 * Chain wins on live hold timestamps when `hold.open`.
 */
export function mergeSettlementSnapshot(
  settlement: AuctionSettlement | null,
  hold: OnChainHold | null,
): SettlementHoldSnapshot | null {
  if (hold?.open) {
    return {
      buyer: hold.buyer,
      gross: hold.gross,
      releaseAt: hold.releaseAt,
      disputedAt: hold.disputedAt,
      bond: hold.bond,
      refundPendingAt: hold.refundPendingAt,
      clearedAt: settlement?.clearedAt ?? null,
      releasedAt: settlement?.releasedAt ?? null,
      receiptConfirmedAt: settlement?.receiptConfirmedAt ?? null,
      platformFee: settlement?.platformFee ?? 0n,
      agentFee: settlement?.agentFee ?? 0n,
      net: settlement?.net ?? 0n,
      disputeOutcome: settlement?.disputeOutcome ?? "",
      autoRelease: settlement?.autoRelease ?? false,
    };
  }

  if (!settlement) return null;

  return {
    buyer: settlement.buyer,
    gross: settlement.gross,
    releaseAt: settlement.releaseAt,
    disputedAt: settlement.disputedAt ?? 0n,
    bond: settlement.bond,
    refundPendingAt: settlement.refundPendingAt ?? 0n,
    clearedAt: settlement.clearedAt,
    releasedAt: settlement.releasedAt,
    receiptConfirmedAt: settlement.receiptConfirmedAt,
    platformFee: settlement.platformFee,
    agentFee: settlement.agentFee,
    net: settlement.net,
    disputeOutcome: settlement.disputeOutcome,
    autoRelease: settlement.autoRelease,
  };
}

/**
 * Derive settlement UI state (blueprint S6–S8 + refund / timeout paths).
 * Precedence: CLEARED → RELEASED → REFUND_PENDING → DISPUTE_TIMED_OUT →
 * DISPUTED → HOLD_RELEASABLE → HOLD → NONE.
 */
export function deriveSettlementUiState(
  input: DeriveSettlementUiStateInput,
): SettlementUiState {
  const snap = mergeSettlementSnapshot(input.settlement, input.hold);
  if (!snap) return "NONE";

  const now = asSec(input.nowSec);
  const timeout = asSec(input.disputeResolutionTimeoutSec);

  if (snap.clearedAt != null && snap.clearedAt > 0n) return "CLEARED";
  if (snap.releasedAt != null && snap.releasedAt > 0n) return "RELEASED";
  if (snap.refundPendingAt > 0n) return "REFUND_PENDING";

  if (snap.disputedAt > 0n) {
    if (timeout > 0n && now >= snap.disputedAt + timeout) {
      return "DISPUTE_TIMED_OUT";
    }
    return "DISPUTED";
  }

  if (snap.releaseAt > 0n) {
    if (now >= snap.releaseAt) return "HOLD_RELEASABLE";
    return "HOLD";
  }

  return "NONE";
}

/** True while settlement countdown / dispute / refund need live 15s polls. */
export function isSettlementPollActive(state: SettlementUiState): boolean {
  return (
    state === "HOLD" || state === "DISPUTED" || state === "REFUND_PENDING"
  );
}
