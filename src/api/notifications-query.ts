import { db } from "ponder:api";
import {
  challenge,
  claimCredit,
  commerceClaimCredit,
  commerceMode,
  consignment,
  consignmentHold,
  mandate,
} from "ponder:schema";
import { and, desc, eq, gt, inArray } from "ponder";
import { getAddress } from "viem";

import {
  approachingNotificationId,
  approachingNotificationKind,
  deriveOutstandingObligations,
  isApproachingDeadline,
} from "../../lib/obligation";
import { RECALL_COOLDOWN_SECONDS } from "../../lib/commerce/recall";
import type { PonderFeedItem } from "../../lib/notifications/types";
import { claimRecordedNotificationItems } from "../lib/ponder-claims";
import { LIVE_PHASES } from "../lib/ponder-commerce";
import { loadObligationFacts } from "./load-obligation-facts";
import { loadPassportRecordsByTokenId } from "../lib/ponder-passport-provenance";
import {
  loadPassportEntitiesByOwner,
  loadPassportEntitiesFiltered,
} from "../lib/ponder-passport-entity";

export type PonderDb = typeof db;

const ATTESTATION_RECORD_TYPE = "attestation";
const RECORDS_PER_PASSPORT_CAP = 20;
const LIVE_PHASE_LIST = [...LIVE_PHASES];

function feedId(type: string, tokenId: string, timestamp: bigint): string {
  return `${type}:${tokenId}:${timestamp}`;
}

function auctionHref(tokenId: string): string {
  return `/auctions/${tokenId}`;
}

export async function buildNotificationFeed(
  ponderDb: PonderDb,
  address: string,
  since: bigint,
  limit: number,
): Promise<PonderFeedItem[]> {
  const normalizedAddress = address.toLowerCase();
  const items: PonderFeedItem[] = [];

  const owned = await loadPassportEntitiesByOwner(normalizedAddress);

  for (const p of owned) {
    if (p.verifiedAt > since && p.verifiedAt > 0n) {
      items.push({
        id: feedId("passport.verified", p.id, p.verifiedAt),
        type: "passport.verified",
        tokenId: p.id,
        timestamp: String(p.verifiedAt),
        actor: p.verifier || undefined,
      });
    }
    if (p.disputeOpenedAt > since && p.disputeOpenedAt > 0n) {
      items.push({
        id: feedId("passport.dispute_opened", p.id, p.disputeOpenedAt),
        type: "passport.dispute_opened",
        tokenId: p.id,
        timestamp: String(p.disputeOpenedAt),
        actor: p.lastDisputer || undefined,
        meta: p.disputeReason ? { reason: p.disputeReason } : undefined,
      });
    }
    if (p.lastDisputeResolvedAt > since && p.lastDisputeResolvedAt > 0n) {
      const terminal = p.lastDisputeTerminal ?? "";
      if (terminal === "expire") {
        items.push({
          id: feedId("passport.dispute_expired", p.id, p.lastDisputeResolvedAt),
          type: "passport.dispute_expired",
          tokenId: p.id,
          timestamp: String(p.lastDisputeResolvedAt),
        });
      } else if (
        terminal === "confirm" ||
        terminal === "reject" ||
        terminal === ""
      ) {
        items.push({
          id: feedId("passport.dispute_resolved", p.id, p.lastDisputeResolvedAt),
          type: "passport.dispute_resolved",
          tokenId: p.id,
          timestamp: String(p.lastDisputeResolvedAt),
          meta: terminal ? { terminal } : undefined,
        });
      }
    }
  }

  for (const p of owned) {
    const records = await loadPassportRecordsByTokenId(p.id);

    const recent = records
      .filter((r) => r.timestamp > since)
      .slice(0, RECORDS_PER_PASSPORT_CAP);
    for (const r of recent) {
      const type =
        r.recordType === ATTESTATION_RECORD_TYPE
          ? "passport.attestation_received"
          : "passport.record_appended";
      items.push({
        id: feedId(type, p.id, r.timestamp),
        type,
        tokenId: p.id,
        timestamp: String(r.timestamp),
        actor: r.author,
        meta: { recordType: r.recordType },
      });
    }
  }

  const checksumAddress = getAddress(normalizedAddress);

  const mandateGrants = await ponderDb
    .select({
      tokenId: mandate.tokenId,
      owner: mandate.owner,
      mode: mandate.mode,
      grantedAt: mandate.grantedAt,
    })
    .from(mandate)
    .where(
      and(
        eq(mandate.agent, checksumAddress),
        eq(mandate.active, true),
        gt(mandate.grantedAt, since),
      ),
    );

  for (const m of mandateGrants) {
    items.push({
      id: feedId("mandate.granted", m.tokenId, m.grantedAt),
      type: "mandate.granted",
      tokenId: m.tokenId,
      timestamp: String(m.grantedAt),
      actor: m.owner || undefined,
      meta: { mode: m.mode },
    });
  }

  const [legacyCredits, commerceCredits] = await Promise.all([
    ponderDb
      .select()
      .from(claimCredit)
      .where(
        and(
          eq(claimCredit.account, checksumAddress),
          gt(claimCredit.timestamp, since),
        ),
      )
      .orderBy(desc(claimCredit.timestamp))
      .limit(limit),
    ponderDb
      .select()
      .from(commerceClaimCredit)
      .where(
        and(
          eq(commerceClaimCredit.account, checksumAddress),
          gt(commerceClaimCredit.timestamp, since),
        ),
      )
      .orderBy(desc(commerceClaimCredit.timestamp))
      .limit(limit),
  ]);

  items.push(
    ...claimRecordedNotificationItems(
      [
        ...legacyCredits.map((r) => ({
          id: r.id,
          chainId: r.chainId,
          contract: r.contract,
          account: r.account,
          asset: r.asset,
          amount: r.amount,
          reasonCode: r.reasonCode,
          timestamp: r.timestamp,
        })),
        ...commerceCredits.map((r) => ({
          id: r.id,
          chainId: r.chainId,
          contract: r.contract,
          account: r.account,
          asset: r.asset,
          amount: r.amount,
          reasonCode: r.reasonCode,
          timestamp: r.timestamp,
        })),
      ],
      checksumAddress,
      since,
    ),
  );

  for (const r of commerceCredits) {
    if (r.reasonCode === "ascending.outbid_refund" && r.timestamp > since) {
      // Cause event carries the lot via correlator; credit row has no tokenId —
      // use contract-scoped id; href falls back to claims until lot is known.
      items.push({
        id: `commerce.bid_refunded:${r.id}`,
        type: "commerce.bid_refunded",
        tokenId: "0",
        timestamp: String(r.timestamp),
        meta: {
          href: `/profile/${checksumAddress}?tab=claims`,
          body: "You were outbid — your previous bid was refunded (see Claims if delivery failed).",
        },
      });
    }
  }

  const verifiedByMe = await loadPassportEntitiesFiltered({
    verifierExact: checksumAddress,
  });

  for (const p of verifiedByMe) {
    if (
      p.disputeOpenedAt > since &&
      p.disputeOpenedAt > 0n &&
      p.status === "DISPUTED"
    ) {
      items.push({
        id: feedId("verifier.dispute_on_verified", p.id, p.disputeOpenedAt),
        type: "verifier.dispute_on_verified",
        tokenId: p.id,
        timestamp: String(p.disputeOpenedAt),
        actor: p.lastDisputer || undefined,
        meta: p.disputeReason ? { reason: p.disputeReason } : undefined,
      });
    }
  }

  // --- Commerce event stamps ---

  const myHolds = await ponderDb
    .select()
    .from(consignmentHold)
    .where(eq(consignmentHold.buyer, checksumAddress));

  for (const hold of myHolds) {
    if (hold.createdAt > since && hold.createdAt > 0n) {
      items.push({
        id: feedId("commerce.settled", hold.tokenId, hold.createdAt),
        type: "commerce.settled",
        tokenId: hold.tokenId,
        timestamp: String(hold.createdAt),
        meta: { href: auctionHref(hold.tokenId) },
      });
    }
    if (
      hold.reversalStartedAt != null &&
      hold.reversalStartedAt > since &&
      hold.reversalStartedAt > 0n
    ) {
      items.push({
        id: feedId(
          "commerce.reversal_started",
          hold.tokenId,
          hold.reversalStartedAt,
        ),
        type: "commerce.reversal_started",
        tokenId: hold.tokenId,
        timestamp: String(hold.reversalStartedAt),
        meta: { href: auctionHref(hold.tokenId) },
      });
    }
  }

  const [sellerLots, agentLots, buyerLots] = await Promise.all([
    ponderDb
      .select()
      .from(consignment)
      .where(
        and(
          eq(consignment.seller, checksumAddress),
          inArray(consignment.phase, LIVE_PHASE_LIST),
        ),
      ),
    ponderDb
      .select()
      .from(consignment)
      .where(
        and(
          eq(consignment.agent, checksumAddress),
          inArray(consignment.phase, LIVE_PHASE_LIST),
        ),
      ),
    ponderDb
      .select()
      .from(consignment)
      .where(
        and(
          eq(consignment.buyer, checksumAddress),
          inArray(consignment.phase, LIVE_PHASE_LIST),
        ),
      ),
  ]);

  const partyTokenIds = [
    ...new Set(
      [...sellerLots, ...agentLots]
        .filter((c) => c.mode === "ascending")
        .map((c) => c.tokenId),
    ),
  ];

  if (partyTokenIds.length > 0) {
    const partyChallenges = await ponderDb
      .select()
      .from(challenge)
      .where(
        and(
          eq(challenge.instance, "ascending"),
          inArray(challenge.subjectId, partyTokenIds),
        ),
      );

    for (const ch of partyChallenges) {
      if (ch.openedAt > since && ch.openedAt > 0n) {
        items.push({
          id: feedId("commerce.challenge_opened", ch.subjectId, ch.openedAt),
          type: "commerce.challenge_opened",
          tokenId: ch.subjectId,
          timestamp: String(ch.openedAt),
          actor: ch.challenger,
          meta: { href: auctionHref(ch.subjectId) },
        });
      }
      if (
        ch.terminalAt != null &&
        ch.terminalAt > since &&
        ch.terminalAt > 0n
      ) {
        if (ch.status === "judged") {
          items.push({
            id: feedId(
              "commerce.challenge_judged",
              ch.subjectId,
              ch.terminalAt,
            ),
            type: "commerce.challenge_judged",
            tokenId: ch.subjectId,
            timestamp: String(ch.terminalAt),
            actor: ch.judge || undefined,
            meta: { href: auctionHref(ch.subjectId) },
          });
        } else if (ch.status === "concluded") {
          items.push({
            id: feedId(
              "commerce.challenge_concluded",
              ch.subjectId,
              ch.terminalAt,
            ),
            type: "commerce.challenge_concluded",
            tokenId: ch.subjectId,
            timestamp: String(ch.terminalAt),
            meta: { href: auctionHref(ch.subjectId) },
          });
        }
      }
    }
  }

  const myChallenges = await ponderDb
    .select()
    .from(challenge)
    .where(
      and(
        eq(challenge.challenger, checksumAddress),
        eq(challenge.instance, "ascending"),
      ),
    );

  for (const ch of myChallenges) {
    if (
      ch.terminalAt != null &&
      ch.terminalAt > since &&
      ch.terminalAt > 0n
    ) {
      if (ch.status === "judged") {
        items.push({
          id: feedId("commerce.challenge_judged", ch.subjectId, ch.terminalAt),
          type: "commerce.challenge_judged",
          tokenId: ch.subjectId,
          timestamp: String(ch.terminalAt),
          actor: ch.judge || undefined,
          meta: { href: auctionHref(ch.subjectId) },
        });
      } else if (ch.status === "concluded") {
        items.push({
          id: feedId(
            "commerce.challenge_concluded",
            ch.subjectId,
            ch.terminalAt,
          ),
          type: "commerce.challenge_concluded",
          tokenId: ch.subjectId,
          timestamp: String(ch.terminalAt),
          meta: { href: auctionHref(ch.subjectId) },
        });
      }
    }
  }

  const recallLots = await ponderDb
    .select()
    .from(consignment)
    .where(
      and(
        eq(consignment.seller, checksumAddress),
        eq(consignment.phase, "offered"),
      ),
    );

  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  for (const lot of recallLots) {
    if (lot.recallRequestedAt == null || lot.recallRequestedAt <= 0n) continue;
    const readyAt = lot.recallRequestedAt + RECALL_COOLDOWN_SECONDS;
    if (readyAt > since && readyAt <= nowSec) {
      items.push({
        id: feedId("commerce.recall_force_ready", lot.tokenId, readyAt),
        type: "commerce.recall_force_ready",
        tokenId: lot.tokenId,
        timestamp: String(readyAt),
        meta: { href: `/marketplace/${lot.tokenId}` },
      });
    }
  }

  const pausedModes = await ponderDb
    .select()
    .from(commerceMode)
    .where(eq(commerceMode.paused, true));

  if (pausedModes.length > 0) {
    const liveAsParty = [...sellerLots, ...agentLots, ...buyerLots];

    for (const mode of pausedModes) {
      const hit = liveAsParty.find(
        (c) =>
          c.chainId === mode.chainId &&
          c.modeContract.toLowerCase() === mode.modeContract.toLowerCase(),
      );
      if (!hit) continue;
      const ts = hit.updatedAt > since ? hit.updatedAt : hit.openedAt;
      if (ts > since) {
        items.push({
          id: feedId("commerce.mode_paused", hit.tokenId, ts),
          type: "commerce.mode_paused",
          tokenId: hit.tokenId,
          timestamp: String(ts),
          meta: {
            href:
              hit.mode === "ascending"
                ? auctionHref(hit.tokenId)
                : `/marketplace/${hit.tokenId}`,
          },
        });
      }
    }
  }

  // Approaching deadlines — same derivation as the Outstanding panel
  try {
    const facts = await loadObligationFacts(checksumAddress);
    const derived = deriveOutstandingObligations(facts, {
      address: checksumAddress,
      nowSec: Number(nowSec),
      isActiveVerifier: false,
    });
    if (derived.status === "ready") {
      for (const obl of derived.items) {
        if (!isApproachingDeadline(obl, Number(nowSec))) continue;
        const kind = approachingNotificationKind(obl);
        if (!kind || obl.deadlineSec == null) continue;
        items.push({
          id: approachingNotificationId(kind, obl.subjectId, obl.deadlineSec),
          type: kind,
          tokenId: obl.tokenId,
          timestamp: String(nowSec),
          meta: {
            href: obl.href,
            body: obl.consequence,
          },
        });
      }
    }
  } catch {
    // Approaching projection is best-effort; event stamps above still stand.
  }

  return items
    .sort((a, b) => {
      const diff = BigInt(b.timestamp) - BigInt(a.timestamp);
      if (diff > 0n) return 1;
      if (diff < 0n) return -1;
      return 0;
    })
    .slice(0, limit);
}
