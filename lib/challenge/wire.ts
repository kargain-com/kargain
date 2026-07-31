import { ZERO_ADDRESS } from "@/lib/commerce/consignment";

/** `BondedChallenge.JudgeOutcome`. */
export const JUDGE_OUTCOME = {
  Upheld: 0,
  Rejected: 1,
} as const;

export type JudgeOutcome = (typeof JUDGE_OUTCOME)[keyof typeof JUDGE_OUTCOME];

/** Canonical terminal names — model §7 / BondedChallenge handlers. */
export type ChallengeTerminal =
  | "upheld"
  | "rejected"
  | "expired"
  | "withdrawn"
  | "";

export type ChallengeSnapshot = {
  readonly subjectId: string;
  readonly challenger: `0x${string}`;
  readonly bondAmount: bigint;
  /**
   * Captured window in seconds. `null` when the chain read failed / pending —
   * never coerce to 0 and invent an open window.
   */
  readonly windowDuration: number | null;
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

/**
 * Parse on-chain challenge reads into a snapshot.
 * Returns null when no challenge is open (openedAt ≤ 0 or zero challenger).
 * When open but windowDuration is missing/zero, snapshot.windowDuration is null
 * so phase derivation fails closed.
 */
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
  const rawWindow = toSeconds(reads.windowDuration);
  return {
    subjectId,
    challenger,
    bondAmount: reads.bondAmount ?? 0n,
    windowDuration: rawWindow > 0 ? rawWindow : null,
    openedAt,
  };
}

/**
 * Wire decode for indexer `lastDisputeTerminal` and similar.
 * Accepts legacy Ponder tags (`confirm` → upheld, `expire` → expired) once here.
 */
export function parseChallengeTerminal(
  raw: string | null | undefined,
): ChallengeTerminal {
  const v = (raw ?? "").trim();
  if (v === "upheld" || v === "confirm") return "upheld";
  if (v === "rejected" || v === "reject") return "rejected";
  if (v === "expired" || v === "expire") return "expired";
  if (v === "withdrawn" || v === "withdraw") return "withdrawn";
  return "";
}
