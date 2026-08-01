import type { ChallengeTerminalSet } from "@/lib/challenge/terminals";
import {
  SETTLEMENT_OPEN_COPY,
  SETTLEMENT_TERMINALS,
  VERIFICATION_OPEN_COPY,
  VERIFICATION_TERMINALS,
} from "@/lib/challenge/terminals";
import type { PassportStatus } from "@/lib/types/ponder";

/** Party exclusion detail — mirrors CannotResolveOwnDispute reasons. */
export type ChallengeExclusionParty =
  | "opener"
  | "owner"
  | "recorded_verifier"
  | "buyer"
  | "seller"
  | "agent";

export type ChallengeInstanceId = "verification" | "settlement";

/**
 * Nuclear / deploy default for the settlement challenge window.
 * Ascending has no on-chain getter for the configured window before a challenge
 * exists — label any pre-open display as this deploy constant.
 * Matches `ASCENDING_CHALLENGE_WINDOW` in scripts/lib/verify-constructor-args.ts.
 *
 * Verification challenge window: do **not** mirror here. Read
 * `KarPassport.DISPUTE_WINDOW` (public constant) on the custody chain; unread
 * → fail closed (null window), never invent 14 days in TS.
 */
export const SETTLEMENT_CHALLENGE_WINDOW_DEPLOY_SECONDS = 14 * 24 * 60 * 60;

export type ChallengeInstance = {
  readonly id: ChallengeInstanceId;
  readonly terminals: ChallengeTerminalSet;
  readonly openDisclosure: string;
  /**
   * Whether this wallet may open a challenge on the subject.
   * `undefined` = required read unresolved (fail closed).
   */
  readonly isEligibleOpener: (ctx: ChallengeEligibilityContext) =>
    | boolean
    | undefined;
  /**
   * Whether this wallet is an active KarPro (may judge *something*).
   * `undefined` = staking read unresolved.
   */
  readonly isQualifiedJudge: (ctx: ChallengeEligibilityContext) =>
    | boolean
    | undefined;
  /** Party exclusion for *this* subject; null when not a party. */
  readonly exclusionParty: (
    ctx: ChallengeEligibilityContext,
  ) => ChallengeExclusionParty | null;
};

export type ChallengeEligibilityContext = {
  readonly wallet: string | null | undefined;
  readonly isActiveVerifier: boolean | undefined;
  /** Verification: passport status. Settlement: ignored. */
  readonly passportStatus?: PassportStatus;
  /** Verification parties. */
  readonly owner?: string;
  readonly recordedVerifier?: string;
  readonly opener?: string;
  /** Settlement parties. */
  readonly buyer?: string | null;
  readonly seller?: string | null;
  readonly agent?: string | null;
  /** Settlement: subject is under an open protection hold (HOLD state). */
  readonly subjectChallengeable?: boolean;
};

function normalizeAddress(addr: string | null | undefined): string {
  return (addr ?? "").trim().toLowerCase();
}

function nonemptyAddress(addr: string | null | undefined): boolean {
  const n = normalizeAddress(addr);
  return n.length > 0 && n !== "0x0000000000000000000000000000000000000000";
}

export function sameAddress(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!nonemptyAddress(a) || !nonemptyAddress(b)) return false;
  return normalizeAddress(a) === normalizeAddress(b);
}

export const VERIFICATION_INSTANCE: ChallengeInstance = {
  id: "verification",
  terminals: VERIFICATION_TERMINALS,
  openDisclosure: VERIFICATION_OPEN_COPY,
  isEligibleOpener(ctx) {
    if (!ctx.wallet) return false;
    if (ctx.passportStatus === undefined) return undefined;
    return ctx.passportStatus === "VERIFIED";
  },
  isQualifiedJudge(ctx) {
    return ctx.isActiveVerifier;
  },
  exclusionParty(ctx) {
    if (!ctx.wallet) return null;
    if (sameAddress(ctx.wallet, ctx.opener)) return "opener";
    if (sameAddress(ctx.wallet, ctx.owner)) return "owner";
    if (sameAddress(ctx.wallet, ctx.recordedVerifier)) return "recorded_verifier";
    return null;
  },
};

export const SETTLEMENT_INSTANCE: ChallengeInstance = {
  id: "settlement",
  terminals: SETTLEMENT_TERMINALS,
  openDisclosure: SETTLEMENT_OPEN_COPY,
  isEligibleOpener(ctx) {
    if (!ctx.wallet) return false;
    if (ctx.subjectChallengeable === undefined) return undefined;
    if (ctx.buyer === undefined) return undefined;
    if (!ctx.subjectChallengeable) return false;
    return sameAddress(ctx.wallet, ctx.buyer);
  },
  isQualifiedJudge(ctx) {
    return ctx.isActiveVerifier;
  },
  exclusionParty(ctx) {
    if (!ctx.wallet) return null;
    if (sameAddress(ctx.wallet, ctx.buyer)) return "buyer";
    if (sameAddress(ctx.wallet, ctx.seller)) return "seller";
    if (sameAddress(ctx.wallet, ctx.agent)) return "agent";
    return null;
  },
};

export function challengeExclusionCopy(
  party: ChallengeExclusionParty | null | undefined,
): string | null {
  switch (party) {
    case "opener":
      return "You opened this challenge, so you cannot judge it. Withdraw before the window ends, or wait for an independent KarPro.";
    case "owner":
      return "You own this passport, so you cannot judge this challenge. Hire an independent KarPro verifier.";
    case "recorded_verifier":
      return "You verified this passport, so you cannot judge this challenge. An independent KarPro must decide, or the window ends in a lapse.";
    case "buyer":
      return "You are the buyer on this sale, so you cannot judge this challenge.";
    case "seller":
      return "You are the seller on this sale, so you cannot judge this challenge.";
    case "agent":
      return "You are the agent on this sale, so you cannot judge this challenge.";
    default:
      return null;
  }
}
