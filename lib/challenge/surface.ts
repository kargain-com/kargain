import {
  type ActionGate,
  AVAILABLE,
  blocked,
  isAvailable,
} from "@/lib/challenge/action-gate";
import {
  type ChallengeEligibilityContext,
  type ChallengeExclusionParty,
  type ChallengeInstance,
  challengeExclusionCopy,
  sameAddress,
} from "@/lib/challenge/instance";
import {
  type ChallengePhase,
  deriveChallengePhase,
} from "@/lib/challenge/phase";
import type { ChallengeTerminalSet } from "@/lib/challenge/terminals";
import type { ChallengeSnapshot } from "@/lib/challenge/wire";

/**
 * Blocked causes — one vocabulary, each mirroring a BondedChallenge guard
 * (or fail-closed unread reads with no on-chain twin).
 */
export type ChallengeBlockCause =
  | "reads_unresolved"
  | "not_eligible"
  | "not_challenger"
  | "party_excluded"
  | "not_qualified"
  | "window_active"
  | "window_elapsed"
  | "no_challenge"
  | "challenge_open"
  | "wrong_subject_state"
  | "no_wallet";

export type ChallengeSurface = {
  readonly phase: ChallengePhase;
  /** True when a challenge exists but window/openedAt inputs are unreadable. */
  readonly phaseUnresolved: boolean;
  readonly windowEndsAt: number;
  readonly windowRemainingSec: number;
  readonly open: ActionGate<ChallengeBlockCause>;
  readonly withdraw: ActionGate<ChallengeBlockCause>;
  readonly judge: ActionGate<ChallengeBlockCause>;
  readonly conclude: ActionGate<ChallengeBlockCause>;
  /** Party exclusion detail when judge is blocked for that reason. */
  readonly exclusionParty: ChallengeExclusionParty | null;
  readonly exclusionCopy: string | null;
  readonly terminals: ChallengeTerminalSet;
  readonly openDisclosure: string;
  readonly isChallenger: boolean;
};

export type DeriveChallengeSurfaceInput = ChallengeEligibilityContext & {
  readonly challenge: ChallengeSnapshot | null | undefined;
  readonly nowSec: number;
  /**
   * Verification in-flight: passport must be DISPUTED.
   * When set and not DISPUTED, all in-flight actions are withheld.
   */
  readonly requireDisputedStatus?: boolean;
};

/**
 * One derivation for both BondedChallenge instances.
 * Actions are available or blocked with named causes — never a bare boolean
 * that collapses "unknown" into "no".
 */
export function deriveChallengeSurface(
  instance: ChallengeInstance,
  input: DeriveChallengeSurfaceInput,
): ChallengeSurface {
  const terminals = instance.terminals;
  const openDisclosure = instance.openDisclosure;
  const exclusionParty = instance.exclusionParty(input);
  const exclusionCopy = challengeExclusionCopy(exclusionParty);

  const none: ChallengeSurface = {
    phase: "none",
    phaseUnresolved: false,
    windowEndsAt: 0,
    windowRemainingSec: 0,
    open: blocked("no_wallet"),
    withdraw: blocked("no_challenge"),
    judge: blocked("no_challenge"),
    conclude: blocked("no_challenge"),
    exclusionParty,
    exclusionCopy,
    terminals,
    openDisclosure,
    isChallenger: false,
  };

  if (input.requireDisputedStatus && input.passportStatus !== "DISPUTED") {
    // Not in a live verification challenge — only open may apply.
    const eligible = instance.isEligibleOpener(input);
    let open: ActionGate<ChallengeBlockCause>;
    if (!input.wallet) {
      open = blocked("no_wallet");
    } else if (eligible === undefined) {
      open = blocked("reads_unresolved");
    } else if (!eligible) {
      open = blocked("wrong_subject_state");
    } else {
      open = AVAILABLE;
    }
    return {
      ...none,
      open,
      withdraw: blocked("no_challenge"),
      judge: blocked("no_challenge"),
      conclude: blocked("no_challenge"),
    };
  }

  const challenge = input.challenge ?? null;
  const isChallenger = Boolean(
    challenge && sameAddress(challenge.challenger, input.wallet),
  );

  if (!challenge) {
    const eligible = instance.isEligibleOpener(input);
    let open: ActionGate<ChallengeBlockCause>;
    if (!input.wallet) {
      open = blocked("no_wallet");
    } else if (eligible === undefined) {
      open = blocked("reads_unresolved");
    } else if (!eligible) {
      open =
        instance.id === "settlement" && input.subjectChallengeable === false
          ? blocked("wrong_subject_state")
          : blocked("not_eligible");
    } else {
      open = AVAILABLE;
    }
    return {
      ...none,
      open,
      withdraw: blocked("no_challenge"),
      judge: blocked("no_challenge"),
      conclude: blocked("no_challenge"),
      isChallenger: false,
    };
  }

  const phaseResult = deriveChallengePhase({
    openedAt: challenge.openedAt,
    windowDuration: challenge.windowDuration,
    nowSec: input.nowSec,
  });

  const open: ActionGate<ChallengeBlockCause> = blocked("challenge_open");

  if (phaseResult.unresolved) {
    return {
      phase: "none",
      phaseUnresolved: true,
      windowEndsAt: 0,
      windowRemainingSec: 0,
      open,
      withdraw: blocked("reads_unresolved"),
      judge: blocked("reads_unresolved"),
      conclude: blocked("reads_unresolved"),
      exclusionParty,
      exclusionCopy,
      terminals,
      openDisclosure,
      isChallenger,
    };
  }

  const { phase, windowEndsAt, windowRemainingSec } = phaseResult;

  let withdraw: ActionGate<ChallengeBlockCause>;
  if (!input.wallet) {
    withdraw = blocked("no_wallet");
  } else if (!isChallenger) {
    withdraw = blocked("not_challenger");
  } else if (phase === "elapsed") {
    withdraw = blocked("window_elapsed");
  } else if (phase !== "active") {
    withdraw = blocked("reads_unresolved");
  } else {
    withdraw = AVAILABLE;
  }

  let conclude: ActionGate<ChallengeBlockCause>;
  if (!input.wallet) {
    conclude = blocked("no_wallet");
  } else if (phase === "active") {
    conclude = blocked("window_active");
  } else if (phase === "elapsed") {
    conclude = AVAILABLE;
  } else {
    conclude = blocked("reads_unresolved");
  }

  let judge: ActionGate<ChallengeBlockCause>;
  if (!input.wallet) {
    judge = blocked("no_wallet");
  } else if (phase === "elapsed") {
    judge = blocked("window_elapsed");
  } else if (phase !== "active") {
    judge = blocked("reads_unresolved");
  } else if (isChallenger || exclusionParty != null) {
    judge = blocked("party_excluded");
  } else {
    const qualified = instance.isQualifiedJudge(input);
    if (qualified === undefined) {
      judge = blocked("reads_unresolved");
    } else if (!qualified) {
      judge = blocked("not_qualified");
    } else {
      judge = AVAILABLE;
    }
  }

  return {
    phase,
    phaseUnresolved: false,
    windowEndsAt,
    windowRemainingSec,
    open,
    withdraw,
    judge,
    conclude,
    exclusionParty: isAvailable(judge) ? null : exclusionParty,
    exclusionCopy: isAvailable(judge)
      ? null
      : judge.status === "blocked" && judge.cause === "party_excluded"
        ? exclusionCopy
        : judge.status === "blocked" && judge.cause === "not_qualified"
          ? "Only an independent active KarPro can judge this challenge."
          : exclusionCopy,
    terminals,
    openDisclosure,
    isChallenger,
  };
}

export { isAvailable };
