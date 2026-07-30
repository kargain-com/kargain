import { ZERO_ADDRESS, addressesMatch } from "@/lib/commerce/consignment";

/** `BondedChallenge.JudgeOutcome`. */
export const JUDGE_OUTCOME = {
  Upheld: 0,
  Rejected: 1,
} as const;

export type JudgeOutcome = (typeof JUDGE_OUTCOME)[keyof typeof JUDGE_OUTCOME];

export type ChallengeSnapshot = {
  readonly subjectId: string;
  readonly challenger: `0x${string}`;
  readonly bondAmount: bigint;
  readonly windowDuration: number;
  readonly openedAt: number;
};

export type ChallengeReads = {
  readonly challenger?: string;
  readonly bondAmount?: bigint;
  readonly windowDuration?: bigint | number;
  readonly openedAt?: bigint | number;
};

function toSeconds(value: bigint | number | undefined): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return 0;
}

export function parseChallenge(
  subjectId: string,
  reads: ChallengeReads | null | undefined,
): ChallengeSnapshot | null {
  if (!reads) return null;
  const openedAt = toSeconds(reads.openedAt);
  if (openedAt <= 0) return null;
  const challenger =
    reads.challenger && reads.challenger.startsWith("0x")
      ? (reads.challenger as `0x${string}`)
      : ZERO_ADDRESS;
  if (challenger === ZERO_ADDRESS) return null;
  return {
    subjectId,
    challenger,
    bondAmount: reads.bondAmount ?? 0n,
    windowDuration: toSeconds(reads.windowDuration),
    openedAt,
  };
}

export type ChallengeWindowPhase = "none" | "active" | "elapsed";

export function challengeWindowPhase(
  challenge: ChallengeSnapshot | null | undefined,
  nowSeconds: number,
): ChallengeWindowPhase {
  if (!challenge) return "none";
  if (challenge.windowDuration <= 0) return "active";
  return nowSeconds < challenge.openedAt + challenge.windowDuration
    ? "active"
    : "elapsed";
}

export function challengeWindowEndsAt(
  challenge: ChallengeSnapshot | null | undefined,
): number | null {
  if (!challenge || challenge.windowDuration <= 0) return null;
  return challenge.openedAt + challenge.windowDuration;
}

/**
 * CH1–CH6 action policy. The challenger may withdraw while the window is open;
 * anyone may conclude once it elapses without a judgement; only an independent
 * judge may rule on the merits, and only inside the window.
 */
export type ChallengeActions = {
  readonly canOpen: boolean;
  readonly canWithdraw: boolean;
  readonly canJudge: boolean;
  readonly canConclude: boolean;
};

export function deriveChallengeActions(input: {
  challenge: ChallengeSnapshot | null | undefined;
  viewer: string | null | undefined;
  /** Parties excluded from judging: buyer, seller, agent, challenger. */
  excludedJudges: readonly (string | null | undefined)[];
  /** Only a settled lot under hold can be challenged. */
  subjectChallengeable: boolean;
  nowSeconds: number;
}): ChallengeActions {
  const { challenge, viewer, excludedJudges, subjectChallengeable, nowSeconds } = input;
  const none: ChallengeActions = {
    canOpen: false,
    canWithdraw: false,
    canJudge: false,
    canConclude: false,
  };
  if (!viewer) return none;

  if (!challenge) {
    return { ...none, canOpen: subjectChallengeable };
  }

  const phase = challengeWindowPhase(challenge, nowSeconds);
  const isChallenger = addressesMatch(challenge.challenger, viewer);
  const excluded =
    isChallenger || excludedJudges.some((party) => addressesMatch(party, viewer));

  return {
    canOpen: false,
    canWithdraw: isChallenger && phase === "active",
    canJudge: !excluded && phase === "active",
    canConclude: phase === "elapsed",
  };
}
