/**
 * Sole challenge-window phase derivation.
 * Phase comes only from opening timestamp + window captured at open.
 * Unreadable inputs never invent an active window.
 */

export type ChallengePhase = "none" | "active" | "elapsed";

export type ChallengePhaseResult =
  | {
      readonly phase: ChallengePhase;
      readonly windowEndsAt: number;
      readonly windowRemainingSec: number;
      readonly unresolved: false;
    }
  | {
      readonly phase: "none";
      readonly windowEndsAt: 0;
      readonly windowRemainingSec: 0;
      /** Live challenge exists but openedAt / windowDuration are unreadable. */
      readonly unresolved: true;
    };

function positiveSeconds(value: number | null | undefined): number | null {
  if (value == null) return null;
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

/**
 * @param openedAt Unix seconds when the challenge opened; null/≤0 = no challenge
 * @param windowDuration Captured window length in seconds; null/≤0 while open = unresolved
 * @param nowSec Current unix seconds
 */
export function deriveChallengePhase(input: {
  openedAt: number | null | undefined;
  windowDuration: number | null | undefined;
  nowSec: number;
}): ChallengePhaseResult {
  const openedAt = positiveSeconds(input.openedAt);
  if (openedAt == null) {
    return {
      phase: "none",
      windowEndsAt: 0,
      windowRemainingSec: 0,
      unresolved: false,
    };
  }

  const windowDuration = positiveSeconds(input.windowDuration);
  if (windowDuration == null) {
    return {
      phase: "none",
      windowEndsAt: 0,
      windowRemainingSec: 0,
      unresolved: true,
    };
  }

  const windowEndsAt = openedAt + windowDuration;
  const phase: ChallengePhase =
    input.nowSec < windowEndsAt ? "active" : "elapsed";
  const windowRemainingSec =
    phase === "active" ? Math.max(0, windowEndsAt - input.nowSec) : 0;

  return {
    phase,
    windowEndsAt,
    windowRemainingSec,
    unresolved: false,
  };
}
