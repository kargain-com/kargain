import {
  challengeWindowEndsAt,
  challengeWindowPhase,
  type ChallengeSnapshot,
} from "@/lib/commerce/challenge";
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
    windowDuration: row.windowDuration,
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

export function challengeWindowSummary(
  row: ChallengeRecord,
  nowSec: number,
): { elapsed: boolean; remainingSec: number; endsAt: number | null } {
  const snapshot = challengeToSnapshot(row);
  const endsAt = challengeWindowEndsAt(snapshot);
  const phase = challengeWindowPhase(snapshot, nowSec);
  const remainingSec =
    endsAt != null && phase === "active" ? Math.max(0, endsAt - nowSec) : 0;
  return {
    elapsed: phase === "elapsed",
    remainingSec,
    endsAt,
  };
}
