import {
  challengeElapsedFeedCopy,
  deriveChallengePhase,
  type ChallengeSnapshot,
} from "@/lib/challenge";
import type {
  ChallengeInstance,
  ChallengeRecord,
  ChallengeStatus,
} from "@/lib/commerce/ponder-consignment";

export function challengeInstanceLabel(instance: ChallengeInstance): string {
  return instance === "passport" ? "Verification" : "Auction settlement";
}

export function challengeStatusLabel(status: ChallengeStatus): string {
  switch (status) {
    case "open":
      return "Open";
    case "withdrawn":
      return "Withdrawn";
    case "judged":
      return "Judged";
    case "concluded":
      return "Concluded";
  }
}

/** Awaiting withdraw, judge, or conclude — not terminal. */
export function isChallengeUnresolved(status: ChallengeStatus): boolean {
  return status === "open" || status === "judged";
}

export function challengeToSnapshot(row: ChallengeRecord): ChallengeSnapshot {
  return {
    subjectId: row.subjectId,
    challenger: row.challenger,
    bondAmount: row.bondAmount,
    windowDuration: row.windowDuration > 0 ? row.windowDuration : null,
    openedAt: row.openedAt,
  };
}

export function challengeSubjectHref(row: ChallengeRecord): string {
  const chain = row.chainId;
  if (row.instance === "passport") {
    return `/marketplace/${row.subjectId}?chain=${chain}&tab=actions`;
  }
  return `/marketplace/${row.subjectId}?chain=${chain}`;
}

/**
 * Window readout for a feed row — phase from the sole derivation.
 * Elapsed copy never offers judge (absent after the window).
 */
export function challengeWindowFeedLine(
  row: ChallengeRecord,
  nowSec: number,
): {
  phase: "none" | "active" | "elapsed";
  unresolved: boolean;
  remainingSec: number;
  endsAt: number;
  elapsedCopy: string | null;
} {
  const snapshot = challengeToSnapshot(row);
  const result = deriveChallengePhase({
    openedAt: snapshot.openedAt,
    windowDuration: snapshot.windowDuration,
    nowSec,
  });
  const instanceId =
    row.instance === "passport" ? "verification" : "settlement";
  return {
    phase: result.phase,
    unresolved: result.unresolved,
    remainingSec: result.windowRemainingSec,
    endsAt: result.windowEndsAt,
    elapsedCopy:
      result.phase === "elapsed" ? challengeElapsedFeedCopy(instanceId) : null,
  };
}
