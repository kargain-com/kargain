import type { OutstandingObligation } from "@/lib/obligation/types";

/** Fixed threshold for “closing / approaching” feed projection. */
export const APPROACHING_DEADLINE_SECONDS = 48 * 60 * 60;

/**
 * Whether an obligation’s clock is within the approaching window.
 * Standing items without a deadline never approach.
 */
export function isApproachingDeadline(
  obligation: OutstandingObligation,
  nowSec: number,
  thresholdSec: number = APPROACHING_DEADLINE_SECONDS,
): boolean {
  if (obligation.deadlineSec == null) return false;
  if (obligation.challengePhaseUnresolved) return false;
  const remaining =
    obligation.remainingSec ?? obligation.deadlineSec - nowSec;
  return remaining > 0 && remaining <= thresholdSec;
}

/** Stable feed id so approaching items refresh rather than spam. */
export function approachingNotificationId(
  kind: string,
  subjectId: string,
  deadlineSec: number,
): string {
  return `${kind}:${subjectId}:${deadlineSec}`;
}

export function approachingNotificationKind(
  obligation: OutstandingObligation,
):
  | "commerce.protection_closing"
  | "commerce.reversal_deadline_approaching"
  | "commerce.challenge_window_closing"
  | null {
  switch (obligation.kind) {
    case "protection_hold":
      return "commerce.protection_closing";
    case "reversal_pending":
      return "commerce.reversal_deadline_approaching";
    case "settlement_challenge":
    case "verification_challenge":
      return "commerce.challenge_window_closing";
    default:
      return null;
  }
}
