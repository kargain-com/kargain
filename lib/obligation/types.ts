/**
 * Outstanding-obligation vocabulary — one answer for panel + feed.
 * Composes challenge phase / settlement state; does not rename them.
 */

import type { ChallengePhase } from "@/lib/challenge";
import type { AscendingSettlementState } from "@/lib/commerce/settlement-state";

export type ObligationRole =
  | "buyer"
  | "bidder"
  | "seller"
  | "agent"
  | "owner"
  | "challenger"
  | "eligible_judge"
  | "recorded_verifier";

export type ObligationKind =
  | "protection_hold"
  | "settlement_challenge"
  | "verification_challenge"
  | "reversal_pending"
  | "standing_bid"
  | "recall_cooldown"
  | "mode_paused_open";

/** Indexer / route facts bag — derivation input, not a second answer. */
export type ObligationConsignmentFact = {
  readonly id: string;
  readonly chainId: number;
  readonly mode: "fixedPrice" | "ascending";
  readonly modeContract: string;
  readonly tokenId: string;
  readonly seller: string;
  readonly agent: string;
  readonly buyer: string;
  /** offered | binding | held | closed | returned */
  readonly phase: string;
  /** Unix seconds; null/0 = none. */
  readonly recallRequestedAt: number | null;
};

export type ObligationHoldFact = {
  readonly id: string;
  readonly consignmentId: string;
  readonly chainId: number;
  readonly tokenId: string;
  readonly buyer: string;
  readonly gross: string;
  readonly protectionEndsAt: number;
  /**
   * active | receiptConfirmed | fundsReleased | reversalStarted |
   * reversalCompleted | reversalAbandoned
   */
  readonly state: string;
  readonly abandonmentDeadline: number | null;
};

export type ObligationBidFact = {
  readonly id: string;
  readonly consignmentId: string;
  readonly chainId: number;
  readonly tokenId: string;
  readonly bidder: string;
  readonly amount: string;
  readonly endsAt: number;
  readonly refunded: boolean;
  readonly timestamp: number;
};

export type ObligationChallengeFact = {
  readonly id: string;
  readonly chainId: number;
  readonly instance: "passport" | "ascending";
  readonly instanceContract: string;
  readonly subjectId: string;
  readonly challenger: string;
  readonly bondAmount: string;
  /** 0 = fail-closed phase unresolved. */
  readonly windowDuration: number;
  readonly openedAt: number;
  readonly status: "open" | "withdrawn" | "judged" | "concluded";
};

export type ObligationPassportFact = {
  readonly tokenId: string;
  readonly chainId: number;
  readonly owner: string;
  readonly status: string;
  readonly verifier: string;
  readonly disputeOpenedAt: number;
  readonly lastDisputer: string;
};

export type ObligationModeFact = {
  readonly chainId: number;
  readonly modeContract: string;
  readonly paused: boolean;
};

export type ObligationFacts = {
  /**
   * True when a required query failed — derivation must not claim emptiness.
   */
  readonly unresolved: boolean;
  readonly consignments: readonly ObligationConsignmentFact[];
  readonly holds: readonly ObligationHoldFact[];
  readonly bids: readonly ObligationBidFact[];
  readonly challenges: readonly ObligationChallengeFact[];
  readonly passports: readonly ObligationPassportFact[];
  readonly modes: readonly ObligationModeFact[];
};

export type OutstandingObligation = {
  readonly id: string;
  readonly chainId: number;
  readonly role: ObligationRole;
  readonly kind: ObligationKind;
  readonly subjectId: string;
  readonly tokenId: string;
  readonly href: string;
  /** Unix seconds; null when standing with no clock (e.g. paused). */
  readonly deadlineSec: number | null;
  readonly remainingSec: number | null;
  /** Challenge window phase when kind is a challenge. */
  readonly challengePhase: ChallengePhase | null;
  readonly challengePhaseUnresolved: boolean;
  /** Settlement lifecycle when kind is hold/reversal. */
  readonly settlementState: AscendingSettlementState | null;
  /** Consequence / duty copy — from challenge terminals or settlement constants. */
  readonly consequence: string;
  readonly title: string;
};

export type DeriveOutstandingInput = {
  readonly address: string | null | undefined;
  readonly nowSec: number;
  /**
   * Active KarPro on any commercial chain — required for eligible_judge.
   * `undefined` = unread (fail closed: no judge rows, not “none outstanding”).
   */
  readonly isActiveVerifier: boolean | undefined;
};

export type OutstandingObligationsResult =
  | {
      readonly status: "ready";
      readonly items: readonly OutstandingObligation[];
      /**
       * True when open challenges exist but staking status is unread —
       * eligible_judge rows may be missing; do not treat count as complete.
       */
      readonly judgeEligibilityUnresolved: boolean;
    }
  | {
      readonly status: "unresolved";
      readonly reason: string;
      readonly items: readonly [];
      readonly judgeEligibilityUnresolved: false;
    };
