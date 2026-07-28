import type { PassportStatus } from "@/lib/types/ponder";

/** Matches KarPassport.DISPUTE_WINDOW (14 days). */
export const PASSPORT_DISPUTE_WINDOW_SECONDS = 14 * 24 * 60 * 60;

export type DisputeWindowPhase = "none" | "active" | "elapsed";

export type DisputeExclusionReason =
  | "opener"
  | "owner"
  | "recorded_verifier"
  | "not_verifier"
  | null;

export type DisputeTerminal =
  | "confirm"
  | "reject"
  | "expire"
  | "withdraw"
  | "";

export type DisputeSurfaceInput = {
  status: PassportStatus;
  /** Unix seconds when the active dispute opened; 0 when none. */
  disputeOpenedAt: number;
  /** Window length in seconds (chain DISPUTE_WINDOW). */
  disputeWindowSec: number;
  /** Current unix seconds (caller-supplied; deadline is from openedAt). */
  nowSec: number;
  wallet: string | null | undefined;
  /** `undefined` = staking read unresolved — fail closed for resolve. */
  isActiveVerifier: boolean | undefined;
  owner: string;
  /** Recorded passportVerifier while disputed (may be empty after clear). */
  recordedVerifier: string;
  /** Dispute opener (lastDisputer / disputeOpenedBy). */
  opener: string;
};

export type DisputeSurface = {
  windowPhase: DisputeWindowPhase;
  /** Unix seconds when the window ends; 0 when not disputed. */
  windowEndsAt: number;
  /** Seconds remaining in the window; 0 when none or elapsed. */
  windowRemainingSec: number;
  canOpen: boolean;
  canWithdraw: boolean;
  canResolve: boolean;
  canExpire: boolean;
  /**
   * Why Confirm/Reject is unavailable for this wallet while DISPUTED.
   * `null` when resolve is offered or the wallet is not relevant.
   */
  exclusionReason: DisputeExclusionReason;
  isOpener: boolean;
  isOwner: boolean;
  isRecordedVerifier: boolean;
};

function normalizeAddress(addr: string | null | undefined): string {
  return (addr ?? "").trim().toLowerCase();
}

function nonemptyAddress(addr: string | null | undefined): boolean {
  const n = normalizeAddress(addr);
  return n.length > 0 && n !== "0x0000000000000000000000000000000000000000";
}

function sameAddress(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!nonemptyAddress(a) || !nonemptyAddress(b)) return false;
  return normalizeAddress(a) === normalizeAddress(b);
}

/**
 * Pure passport dispute action policy.
 * An action is offered only when this wallet can succeed on-chain.
 */
export function deriveDisputeSurface(
  input: DisputeSurfaceInput,
): DisputeSurface {
  const isOpener = sameAddress(input.wallet, input.opener);
  const isOwner = sameAddress(input.wallet, input.owner);
  const isRecordedVerifier = sameAddress(
    input.wallet,
    input.recordedVerifier,
  );

  const base: DisputeSurface = {
    windowPhase: "none",
    windowEndsAt: 0,
    windowRemainingSec: 0,
    canOpen: false,
    canWithdraw: false,
    canResolve: false,
    canExpire: false,
    exclusionReason: null,
    isOpener,
    isOwner,
    isRecordedVerifier,
  };

  if (input.status === "VERIFIED") {
    return {
      ...base,
      canOpen: Boolean(input.wallet),
    };
  }

  if (input.status !== "DISPUTED") {
    return base;
  }

  const openedAt =
    Number.isFinite(input.disputeOpenedAt) && input.disputeOpenedAt > 0
      ? input.disputeOpenedAt
      : 0;
  const windowSec =
    Number.isFinite(input.disputeWindowSec) && input.disputeWindowSec > 0
      ? input.disputeWindowSec
      : PASSPORT_DISPUTE_WINDOW_SECONDS;
  const windowEndsAt = openedAt > 0 ? openedAt + windowSec : 0;
  const windowPhase: DisputeWindowPhase =
    openedAt <= 0
      ? "none"
      : input.nowSec < windowEndsAt
        ? "active"
        : "elapsed";
  const windowRemainingSec =
    windowPhase === "active" ? Math.max(0, windowEndsAt - input.nowSec) : 0;

  const partyExcluded = isOpener || isOwner || isRecordedVerifier;
  let exclusionReason: DisputeExclusionReason = null;
  if (input.wallet) {
    if (isOpener) exclusionReason = "opener";
    else if (isOwner) exclusionReason = "owner";
    else if (isRecordedVerifier) exclusionReason = "recorded_verifier";
    else if (input.isActiveVerifier !== true) exclusionReason = "not_verifier";
  }

  const canResolve =
    Boolean(input.wallet) &&
    input.isActiveVerifier === true &&
    !partyExcluded;

  return {
    windowPhase,
    windowEndsAt,
    windowRemainingSec,
    canOpen: false,
    canWithdraw:
      Boolean(input.wallet) && isOpener && windowPhase === "active",
    canResolve,
    canExpire:
      Boolean(input.wallet) &&
      windowPhase === "elapsed" &&
      openedAt > 0,
    exclusionReason: canResolve ? null : exclusionReason,
    isOpener,
    isOwner,
    isRecordedVerifier,
  };
}

export function disputeExclusionCopy(
  reason: DisputeExclusionReason,
): string | null {
  switch (reason) {
    case "opener":
      return "You opened this dispute, so you cannot resolve it. Withdraw before the window ends, or wait for an independent KarPro.";
    case "owner":
      return "You own this passport, so you cannot resolve this dispute. Hire an independent KarPro verifier.";
    case "recorded_verifier":
      return "You verified this passport, so you cannot resolve this challenge. An independent KarPro must decide, or the window ends in a lapse.";
    case "not_verifier":
      return "Only an independent active KarPro can resolve this dispute.";
    default:
      return null;
  }
}

export function parseDisputeTerminal(
  raw: string | null | undefined,
): DisputeTerminal {
  const v = (raw ?? "").trim();
  if (
    v === "confirm" ||
    v === "reject" ||
    v === "expire" ||
    v === "withdraw"
  ) {
    return v;
  }
  return "";
}
