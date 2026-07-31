import type { ChallengeTerminalId } from "@/lib/challenge/terminals";
import {
  VERIFICATION_TERMINALS,
} from "@/lib/challenge/terminals";
import {
  parseChallengeTerminal,
  type ChallengeTerminal,
} from "@/lib/challenge/wire";
import type { PassportStatus } from "@/lib/types/ponder";

export type ChallengeTrustCopyKind =
  | "lapsed"
  | "upheld"
  | "previously_disputed"
  | null;

/**
 * Trust banner / readout kind for closed verification challenges.
 * Lapse is informational (not status-error): assertion lost backing, not a penalty.
 */
export function challengeTrustCopyKind(params: {
  status: PassportStatus;
  hadDispute: boolean;
  lastDisputeTerminal: string;
}): ChallengeTrustCopyKind {
  const terminal = parseChallengeTerminal(params.lastDisputeTerminal);
  if (params.status === "UNVERIFIED" && terminal === "expired") {
    return "lapsed";
  }
  if (params.status === "UNVERIFIED" && terminal === "upheld") {
    return "upheld";
  }
  if (params.hadDispute && params.status !== "DISPUTED") {
    return "previously_disputed";
  }
  return null;
}

export function challengeTerminalTimelineLabel(
  terminal: ChallengeTerminal,
): string | null {
  if (!terminal) return null;
  return VERIFICATION_TERMINALS[terminal as ChallengeTerminalId]?.label ?? null;
}

export function challengeTerminalTimelineDescription(
  terminal: ChallengeTerminal,
): string | null {
  if (!terminal) return null;
  return (
    VERIFICATION_TERMINALS[terminal as ChallengeTerminalId]?.description ?? null
  );
}
