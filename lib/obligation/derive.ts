/**
 * Sole outstanding-obligation derivation — panel + feed consumers only.
 * Composes deriveChallengePhase / deriveChallengeSurface / settlement state.
 */

import {
  SETTLEMENT_INSTANCE,
  SETTLEMENT_TERMINALS,
  VERIFICATION_INSTANCE,
  VERIFICATION_TERMINALS,
  challengeElapsedFeedCopy,
  deriveChallengePhase,
  deriveChallengeSurface,
  isAvailable,
  sameAddress,
  type ChallengeSnapshot,
} from "@/lib/challenge";
import { addressesMatch, isZeroAddress } from "@/lib/commerce/consignment";
import { RECALL_COOLDOWN_SECONDS, recallDeadline } from "@/lib/commerce/recall";
import {
  REVERSAL_ABANDONMENT_CONSEQUENCE,
  ascendingSettlementCopy,
  deriveAscendingSettlementState,
  type AscendingSettlementState,
} from "@/lib/commerce/settlement-state";
import type { AscendingHoldSnapshot } from "@/lib/commerce/parse-ascending";
import type { PassportStatus } from "@/lib/types/ponder";
import {
  type DeriveOutstandingInput,
  type ObligationChallengeFact,
  type ObligationConsignmentFact,
  type ObligationFacts,
  type ObligationHoldFact,
  type ObligationPassportFact,
  type ObligationRole,
  type OutstandingObligation,
  type OutstandingObligationsResult,
} from "@/lib/obligation/types";

const LIVE_PHASES = new Set(["offered", "binding", "held"]);
const ACTIVE_HOLD_STATES = new Set(["active", "reversalStarted"]);

function passportHref(tokenId: string): string {
  return `/marketplace/${tokenId}`;
}

function auctionHref(tokenId: string): string {
  return `/auctions/${tokenId}`;
}

function holdSnapshot(hold: ObligationHoldFact): AscendingHoldSnapshot {
  return {
    buyer: (hold.buyer.startsWith("0x")
      ? hold.buyer
      : "0x0000000000000000000000000000000000000000") as `0x${string}`,
    gross: BigInt(hold.gross || "0"),
    protectionEndsAt: hold.protectionEndsAt,
    frozenRemaining: 0,
    reversalPending: hold.state === "reversalStarted",
    abandonmentDeadline: hold.abandonmentDeadline ?? 0,
    abandonmentWindow: 0,
  };
}

function challengeSnapshot(
  row: ObligationChallengeFact,
): ChallengeSnapshot | null {
  if (row.status !== "open" || row.openedAt <= 0) return null;
  const challenger = row.challenger.startsWith("0x")
    ? (row.challenger as `0x${string}`)
    : ("0x0000000000000000000000000000000000000000" as `0x${string}`);
  return {
    subjectId: row.subjectId,
    challenger,
    bondAmount: BigInt(row.bondAmount || "0"),
    windowDuration: row.windowDuration > 0 ? row.windowDuration : null,
    openedAt: row.openedAt,
  };
}

function consignmentById(
  facts: ObligationFacts,
): Map<string, ObligationConsignmentFact> {
  const map = new Map<string, ObligationConsignmentFact>();
  for (const c of facts.consignments) map.set(c.id, c);
  return map;
}

function consignmentForToken(
  facts: ObligationFacts,
  chainId: number,
  tokenId: string,
): ObligationConsignmentFact | undefined {
  return facts.consignments.find(
    (c) => c.chainId === chainId && c.tokenId === tokenId && LIVE_PHASES.has(c.phase),
  );
}

function partyRolesOnConsignment(
  address: string,
  c: ObligationConsignmentFact,
): ObligationRole[] {
  const roles: ObligationRole[] = [];
  if (addressesMatch(address, c.buyer) && !isZeroAddress(c.buyer)) {
    roles.push("buyer");
  }
  if (addressesMatch(address, c.seller)) roles.push("seller");
  if (addressesMatch(address, c.agent) && !isZeroAddress(c.agent)) {
    roles.push("agent");
  }
  return roles;
}

function protectionConsequence(
  role: ObligationRole,
  state: AscendingSettlementState,
): string {
  if (role === "buyer") {
    if (state === "HOLD") {
      return "Confirm receipt or open a bonded challenge before the window ends. After it ends, funds can be released to the seller.";
    }
    if (state === "HOLD_RELEASABLE") {
      return "The protection window has passed. Funds can be released to the seller.";
    }
  }
  return ascendingSettlementCopy(state);
}

function pushUnique(
  items: OutstandingObligation[],
  seen: Set<string>,
  item: OutstandingObligation,
): void {
  if (seen.has(item.id)) return;
  seen.add(item.id);
  items.push(item);
}

function emitHoldObligations(
  facts: ObligationFacts,
  address: string,
  nowSec: number,
  items: OutstandingObligation[],
  seen: Set<string>,
): void {
  const byId = consignmentById(facts);
  const openChallengesBySubject = new Map<string, ObligationChallengeFact>();
  for (const ch of facts.challenges) {
    if (ch.status === "open" && ch.instance === "ascending") {
      openChallengesBySubject.set(
        `${ch.chainId}:${ch.subjectId}`,
        ch,
      );
    }
  }

  for (const hold of facts.holds) {
    if (!ACTIVE_HOLD_STATES.has(hold.state)) continue;
    const consignment = byId.get(hold.consignmentId);
    if (!consignment) continue;

    const roles = partyRolesOnConsignment(address, consignment);
    if (roles.length === 0) continue;

    const challengeRow = openChallengesBySubject.get(
      `${hold.chainId}:${hold.tokenId}`,
    );
    const challenge = challengeRow ? challengeSnapshot(challengeRow) : null;
    const snap = holdSnapshot(hold);
    const state = deriveAscendingSettlementState({
      hold: snap,
      challenge,
      nowSec,
    });

    if (state === "NONE") continue;

    // Challenge open → challenge obligations own the clock; skip hold row.
    if (
      state === "CHALLENGED" ||
      state === "CHALLENGE_ELAPSED" ||
      state === "CHALLENGE_UNRESOLVED"
    ) {
      continue;
    }

    for (const role of roles) {
      if (state === "REVERSAL_PENDING" || state === "REVERSAL_EXPIRED") {
        const deadline = hold.abandonmentDeadline;
        pushUnique(items, seen, {
          id: `reversal_pending:${hold.chainId}:${hold.tokenId}:${role}`,
          chainId: hold.chainId,
          role,
          kind: "reversal_pending",
          subjectId: hold.tokenId,
          tokenId: hold.tokenId,
          href: auctionHref(hold.tokenId),
          deadlineSec: deadline != null && deadline > 0 ? deadline : null,
          remainingSec:
            deadline != null && deadline > 0
              ? Math.max(0, deadline - nowSec)
              : null,
          challengePhase: null,
          challengePhaseUnresolved: false,
          settlementState: state,
          consequence:
            role === "buyer"
              ? REVERSAL_ABANDONMENT_CONSEQUENCE
              : ascendingSettlementCopy(state),
          title:
            state === "REVERSAL_EXPIRED"
              ? "Reversal deadline passed"
              : "Reversal pending",
        });
        continue;
      }

      if (state === "HOLD" || state === "HOLD_RELEASABLE") {
        const deadline = hold.protectionEndsAt;
        pushUnique(items, seen, {
          id: `protection_hold:${hold.chainId}:${hold.tokenId}:${role}`,
          chainId: hold.chainId,
          role,
          kind: "protection_hold",
          subjectId: hold.tokenId,
          tokenId: hold.tokenId,
          href: auctionHref(hold.tokenId),
          deadlineSec: deadline > 0 ? deadline : null,
          remainingSec:
            deadline > 0 ? Math.max(0, deadline - nowSec) : null,
          challengePhase: null,
          challengePhaseUnresolved: false,
          settlementState: state,
          consequence: protectionConsequence(role, state),
          title:
            state === "HOLD_RELEASABLE"
              ? "Protection window ended"
              : "Protection hold",
        });
      }
    }
  }
}

function emitChallengeObligations(
  facts: ObligationFacts,
  address: string,
  nowSec: number,
  isActiveVerifier: boolean | undefined,
  items: OutstandingObligation[],
  seen: Set<string>,
): void {
  const byId = consignmentById(facts);
  const passportsByToken = new Map<string, ObligationPassportFact>();
  for (const p of facts.passports) passportsByToken.set(p.tokenId, p);

  for (const row of facts.challenges) {
    if (row.status !== "open") continue;
    const challenge = challengeSnapshot(row);
    if (!challenge) continue;

    const phase = deriveChallengePhase({
      openedAt: challenge.openedAt,
      windowDuration: challenge.windowDuration,
      nowSec,
    });

    const deadlineSec = phase.unresolved ? null : phase.windowEndsAt;
    const remainingSec = phase.unresolved ? null : phase.windowRemainingSec;
    const instanceLabel =
      row.instance === "passport" ? "verification" : "settlement";
    const terminals =
      row.instance === "passport"
        ? VERIFICATION_TERMINALS
        : SETTLEMENT_TERMINALS;
    const consequence =
      phase.unresolved
        ? "Challenge window details are still loading."
        : phase.phase === "elapsed"
          ? challengeElapsedFeedCopy(instanceLabel)
          : phase.phase === "active"
            ? terminals.expired.description
            : "";

    const href =
      row.instance === "passport"
        ? `${passportHref(row.subjectId)}?tab=actions`
        : auctionHref(row.subjectId);

    const title =
      phase.phase === "elapsed"
        ? "Challenge window ended"
        : row.instance === "passport"
          ? "Verification challenge open"
          : "Settlement challenge open";

    const base = {
      chainId: row.chainId,
      kind:
        row.instance === "passport"
          ? ("verification_challenge" as const)
          : ("settlement_challenge" as const),
      subjectId: row.subjectId,
      tokenId: row.subjectId,
      href,
      deadlineSec,
      remainingSec,
      challengePhase: phase.phase,
      challengePhaseUnresolved: phase.unresolved,
      settlementState: null as AscendingSettlementState | null,
      consequence,
      title,
    };

    // Challenger
    if (sameAddress(address, row.challenger)) {
      pushUnique(items, seen, {
        ...base,
        id: `${base.kind}:${row.chainId}:${row.subjectId}:challenger`,
        role: "challenger",
        consequence:
          phase.phase === "active"
            ? "You opened this challenge. Withdraw before the window ends to recover your bond."
            : consequence,
      });
    }

    if (row.instance === "passport") {
      const passport = passportsByToken.get(row.subjectId);
      const owner = passport?.owner;
      const verifier = passport?.verifier;
      const status = (passport?.status ?? "DISPUTED") as PassportStatus;

      if (owner && sameAddress(address, owner)) {
        pushUnique(items, seen, {
          ...base,
          id: `${base.kind}:${row.chainId}:${row.subjectId}:owner`,
          role: "owner",
          consequence:
            phase.phase === "active"
              ? "A challenge is open against your passport. An independent KarPro may judge it while the window is active."
              : consequence,
        });
      }
      if (verifier && sameAddress(address, verifier)) {
        pushUnique(items, seen, {
          ...base,
          id: `${base.kind}:${row.chainId}:${row.subjectId}:recorded_verifier`,
          role: "recorded_verifier",
          consequence:
            "A challenge is open on a passport you verified. You cannot judge it — an independent KarPro may.",
        });
      }

      const surface = deriveChallengeSurface(VERIFICATION_INSTANCE, {
        challenge,
        wallet: address,
        isActiveVerifier,
        passportStatus: status,
        owner,
        recordedVerifier: verifier,
        opener: row.challenger,
        nowSec,
        requireDisputedStatus: true,
      });
      if (isAvailable(surface.judge)) {
        pushUnique(items, seen, {
          ...base,
          id: `${base.kind}:${row.chainId}:${row.subjectId}:eligible_judge`,
          role: "eligible_judge",
          consequence:
            "This challenge awaits an independent KarPro judgment while the window is active.",
          title: "Challenge awaiting judgment",
        });
      }
    } else {
      const consignment =
        byId.get(
          facts.holds.find(
            (h) =>
              h.chainId === row.chainId && h.tokenId === row.subjectId,
          )?.consignmentId ?? "",
        ) ?? consignmentForToken(facts, row.chainId, row.subjectId);

      const buyer = consignment?.buyer;
      const seller = consignment?.seller;
      const agent = consignment?.agent;

      for (const role of consignment
        ? partyRolesOnConsignment(address, consignment)
        : []) {
        pushUnique(items, seen, {
          ...base,
          id: `${base.kind}:${row.chainId}:${row.subjectId}:${role}`,
          role,
          consequence:
            role === "buyer" && phase.phase === "active"
              ? "Your settlement challenge is open. Withdraw before the window ends to resume the protection clock."
              : consequence,
        });
      }

      const surface = deriveChallengeSurface(SETTLEMENT_INSTANCE, {
        challenge,
        wallet: address,
        isActiveVerifier,
        buyer,
        seller,
        agent,
        subjectChallengeable: true,
        nowSec,
      });
      if (isAvailable(surface.judge)) {
        pushUnique(items, seen, {
          ...base,
          id: `${base.kind}:${row.chainId}:${row.subjectId}:eligible_judge`,
          role: "eligible_judge",
          consequence:
            "This settlement challenge awaits an independent KarPro judgment while the window is active.",
          title: "Challenge awaiting judgment",
        });
      }
    }
  }
}

function emitStandingBids(
  facts: ObligationFacts,
  address: string,
  nowSec: number,
  items: OutstandingObligation[],
  seen: Set<string>,
): void {
  const byId = consignmentById(facts);
  for (const bid of facts.bids) {
    if (bid.refunded) continue;
    if (!sameAddress(address, bid.bidder)) continue;
    const consignment = byId.get(bid.consignmentId);
    if (!consignment || consignment.phase !== "binding") continue;

    const deadline = bid.endsAt;
    pushUnique(items, seen, {
      id: `standing_bid:${bid.chainId}:${bid.tokenId}:${bid.id}`,
      chainId: bid.chainId,
      role: "bidder",
      kind: "standing_bid",
      subjectId: bid.tokenId,
      tokenId: bid.tokenId,
      href: auctionHref(bid.tokenId),
      deadlineSec: deadline > 0 ? deadline : null,
      remainingSec: deadline > 0 ? Math.max(0, deadline - nowSec) : null,
      challengePhase: null,
      challengePhaseUnresolved: false,
      settlementState: null,
      consequence:
        "Your bid is held in escrow until you are outbid, the lot settles, or the sale closes.",
      title: "Standing bid",
    });
  }
}

function emitRecall(
  facts: ObligationFacts,
  address: string,
  nowSec: number,
  items: OutstandingObligation[],
  seen: Set<string>,
): void {
  for (const c of facts.consignments) {
    if (c.phase !== "offered") continue;
    if (c.recallRequestedAt == null || c.recallRequestedAt <= 0) continue;
    if (!addressesMatch(address, c.seller) && !addressesMatch(address, c.agent)) {
      continue;
    }
    const role: ObligationRole = addressesMatch(address, c.seller)
      ? "owner"
      : "agent";
    const requestedAt = BigInt(c.recallRequestedAt);
    const deadline = Number(recallDeadline(requestedAt));
    const remaining = Math.max(0, deadline - nowSec);
    // Labelled deploy constant — same honesty as S30 (no chain getter on list).
    void RECALL_COOLDOWN_SECONDS;
    pushUnique(items, seen, {
      id: `recall_cooldown:${c.chainId}:${c.tokenId}:${role}`,
      chainId: c.chainId,
      role,
      kind: "recall_cooldown",
      subjectId: c.tokenId,
      tokenId: c.tokenId,
      href: passportHref(c.tokenId),
      deadlineSec: deadline,
      remainingSec: remaining,
      challengePhase: null,
      challengePhaseUnresolved: false,
      settlementState: null,
      consequence:
        remaining > 0
          ? "A recall was requested. After the cooldown, the owner may force the passport’s return."
          : "The recall cooldown has elapsed. The owner may force the passport’s return.",
      title:
        remaining > 0 ? "Recall cooldown" : "Recall ready to force",
    });
  }
}

function emitPaused(
  facts: ObligationFacts,
  address: string,
  items: OutstandingObligation[],
  seen: Set<string>,
): void {
  const pausedModes = new Set(
    facts.modes
      .filter((m) => m.paused)
      .map((m) => `${m.chainId}:${m.modeContract.toLowerCase()}`),
  );
  if (pausedModes.size === 0) return;

  for (const c of facts.consignments) {
    if (!LIVE_PHASES.has(c.phase)) continue;
    const key = `${c.chainId}:${c.modeContract.toLowerCase()}`;
    if (!pausedModes.has(key)) continue;
    const roles: ObligationRole[] = partyRolesOnConsignment(address, c);
    if (roles.length === 0 && addressesMatch(address, c.seller)) {
      roles.push("seller");
    }
    for (const role of roles) {
      pushUnique(items, seen, {
        id: `mode_paused_open:${c.chainId}:${c.tokenId}:${role}`,
        chainId: c.chainId,
        role,
        kind: "mode_paused_open",
        subjectId: c.tokenId,
        tokenId: c.tokenId,
        href:
          c.mode === "ascending"
            ? auctionHref(c.tokenId)
            : passportHref(c.tokenId),
        deadlineSec: null,
        remainingSec: null,
        challengePhase: null,
        challengePhaseUnresolved: false,
        settlementState: null,
        consequence:
          "This mode is paused while you have an open consignment. Commerce actions on the lot are blocked until it is unpaused.",
        title: "Mode paused",
      });
    }
  }
}

/**
 * What is outstanding for an address, in which role, with which deadline.
 * Fail closed: unread facts or unread verifier status never become “nothing”.
 */
export function deriveOutstandingObligations(
  facts: ObligationFacts,
  input: DeriveOutstandingInput,
): OutstandingObligationsResult {
  if (facts.unresolved) {
    return {
      status: "unresolved",
      reason: "facts_unresolved",
      items: [],
      judgeEligibilityUnresolved: false,
    };
  }

  const address = input.address?.trim();
  if (!address) {
    return {
      status: "unresolved",
      reason: "no_wallet",
      items: [],
      judgeEligibilityUnresolved: false,
    };
  }

  const openChallenges = facts.challenges.filter((c) => c.status === "open");
  const judgeEligibilityUnresolved =
    openChallenges.length > 0 && input.isActiveVerifier === undefined;

  const items: OutstandingObligation[] = [];
  const seen = new Set<string>();
  const nowSec = input.nowSec;

  emitHoldObligations(facts, address, nowSec, items, seen);
  emitChallengeObligations(
    facts,
    address,
    nowSec,
    // Pass false while unread so surface blocks judge with not_qualified;
    // judgeEligibilityUnresolved flags that this is incomplete.
    input.isActiveVerifier === undefined ? false : input.isActiveVerifier,
    items,
    seen,
  );
  emitStandingBids(facts, address, nowSec, items, seen);
  emitRecall(facts, address, nowSec, items, seen);
  emitPaused(facts, address, items, seen);

  items.sort((a, b) => {
    const da = a.deadlineSec ?? Number.MAX_SAFE_INTEGER;
    const db = b.deadlineSec ?? Number.MAX_SAFE_INTEGER;
    if (da !== db) return da - db;
    return a.id.localeCompare(b.id);
  });

  return {
    status: "ready",
    items,
    judgeEligibilityUnresolved,
  };
}

/** Count for badges — unresolved / incomplete judge scan stays distinct from zero. */
export function outstandingCount(
  result: OutstandingObligationsResult,
): number | null {
  if (result.status === "unresolved") return null;
  if (result.judgeEligibilityUnresolved) return null;
  return result.items.length;
}
