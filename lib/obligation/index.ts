/**
 * Sole outstanding-obligation derivation — panel + feed.
 * Compose challenge / settlement owners; do not invent a second vocabulary.
 */

export {
  APPROACHING_DEADLINE_SECONDS,
  approachingNotificationId,
  approachingNotificationKind,
  isApproachingDeadline,
} from "@/lib/obligation/approaching";

export {
  deriveOutstandingObligations,
  outstandingCount,
} from "@/lib/obligation/derive";

export type {
  DeriveOutstandingInput,
  ObligationBidFact,
  ObligationChallengeFact,
  ObligationConsignmentFact,
  ObligationFacts,
  ObligationHoldFact,
  ObligationKind,
  ObligationModeFact,
  ObligationPassportFact,
  ObligationRole,
  OutstandingObligation,
  OutstandingObligationsResult,
} from "@/lib/obligation/types";
