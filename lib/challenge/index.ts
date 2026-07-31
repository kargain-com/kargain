/**
 * Sole BondedChallenge application derivation — phase, actions, terminal meaning.
 * Both instances (verification + settlement) are parameters, not branches.
 */

export {
  type ActionGate,
  AVAILABLE,
  blocked,
  isAvailable,
} from "@/lib/challenge/action-gate";

export {
  type ChallengePhase,
  type ChallengePhaseResult,
  deriveChallengePhase,
} from "@/lib/challenge/phase";

export {
  type ChallengeBlockCause,
  type ChallengeSurface,
  type DeriveChallengeSurfaceInput,
  deriveChallengeSurface,
} from "@/lib/challenge/surface";

export {
  type ChallengeEligibilityContext,
  type ChallengeExclusionParty,
  type ChallengeInstance,
  type ChallengeInstanceId,
  SETTLEMENT_CHALLENGE_WINDOW_DEPLOY_SECONDS,
  SETTLEMENT_INSTANCE,
  VERIFICATION_CHALLENGE_WINDOW_SECONDS,
  VERIFICATION_INSTANCE,
  challengeExclusionCopy,
  sameAddress,
} from "@/lib/challenge/instance";

export {
  type ChallengeTerminalDef,
  type ChallengeTerminalId,
  type ChallengeTerminalSet,
  CHALLENGE_CLAIMS_DISCLOSURE,
  SETTLEMENT_OPEN_COPY,
  SETTLEMENT_TERMINALS,
  VERIFICATION_OPEN_COPY,
  VERIFICATION_TERMINALS,
  challengeElapsedFeedCopy,
} from "@/lib/challenge/terminals";

export {
  type ChallengeTrustCopyKind,
  challengeTerminalTimelineDescription,
  challengeTerminalTimelineLabel,
  challengeTrustCopyKind,
} from "@/lib/challenge/trust-copy";

export {
  type ChallengeReads,
  type ChallengeSnapshot,
  type ChallengeTerminal,
  type JudgeOutcome,
  JUDGE_OUTCOME,
  parseChallenge,
  parseChallengeTerminal,
} from "@/lib/challenge/wire";
