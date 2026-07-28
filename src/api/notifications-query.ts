import { db } from "ponder:api";
import {
  agentAuthorization,
  auctionAgentAuthorization,
  claimCredit,
  marketplaceListing,
  passport,
  passportRecord,
} from "ponder:schema";
import { and, desc, eq, gt } from "ponder";
import { getAddress } from "viem";

import type { PonderFeedItem } from "../../lib/notifications/types";
import { authorizationNotificationItems } from "../lib/ponder-agent-authorization";
import { claimRecordedNotificationItems } from "../lib/ponder-claims";

export type PonderDb = typeof db;

const ATTESTATION_RECORD_TYPE = "attestation";
const RECORDS_PER_PASSPORT_CAP = 20;

function feedId(type: string, tokenId: string, timestamp: bigint): string {
  return `${type}:${tokenId}:${timestamp}`;
}

export async function buildNotificationFeed(
  ponderDb: PonderDb,
  address: string,
  since: bigint,
  limit: number,
): Promise<PonderFeedItem[]> {
  const normalizedAddress = address.toLowerCase();
  const items: PonderFeedItem[] = [];

  const owned = await ponderDb
    .select()
    .from(passport)
    .where(eq(passport.owner, normalizedAddress));

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
      } else if (terminal === "confirm" || terminal === "reject" || terminal === "") {
        // "" = pre-terminal-tag rows until reindex; treat as resolved.
        items.push({
          id: feedId("passport.dispute_resolved", p.id, p.lastDisputeResolvedAt),
          type: "passport.dispute_resolved",
          tokenId: p.id,
          timestamp: String(p.lastDisputeResolvedAt),
          meta: terminal ? { terminal } : undefined,
        });
      }
      // withdraw stamps lastDisputeResolvedAt? No — withdraw uses disputeWithdrawnAt only.
      // confirm/reject/expire set lastDisputeResolvedAt.
    }
  }

  for (const p of owned) {
    const records = await ponderDb
      .select()
      .from(passportRecord)
      .where(eq(passportRecord.tokenId, p.id))
      .orderBy(desc(passportRecord.timestamp));

    const recent = records.filter((r) => r.timestamp > since).slice(0, RECORDS_PER_PASSPORT_CAP);
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

  const sellerListings = await ponderDb
    .select()
    .from(marketplaceListing)
    .where(eq(marketplaceListing.seller, normalizedAddress));

  for (const l of sellerListings) {
    if (l.soldAt > since && l.soldAt > 0n) {
      items.push({
        id: feedId("listing.sold", l.tokenId, l.soldAt),
        type: "listing.sold",
        tokenId: l.tokenId,
        timestamp: String(l.soldAt),
        actor: l.buyer || undefined,
      });
    }
  }

  const checksumAddress = getAddress(normalizedAddress);
  const [marketplaceAuthorizations, auctionAuthorizations] =
    await Promise.all([
      ponderDb
        .select({
          tokenId: agentAuthorization.tokenId,
          owner: agentAuthorization.owner,
          agent: agentAuthorization.agent,
          active: agentAuthorization.active,
          authorizedAt: agentAuthorization.authorizedAt,
        })
        .from(agentAuthorization)
        .where(
          and(
            eq(agentAuthorization.agent, checksumAddress),
            eq(agentAuthorization.active, true),
            gt(agentAuthorization.authorizedAt, since),
          ),
        ),
      ponderDb
        .select({
          tokenId: auctionAgentAuthorization.tokenId,
          owner: auctionAgentAuthorization.owner,
          agent: auctionAgentAuthorization.agent,
          active: auctionAgentAuthorization.active,
          authorizedAt: auctionAgentAuthorization.authorizedAt,
        })
        .from(auctionAgentAuthorization)
        .where(
          and(
            eq(auctionAgentAuthorization.agent, checksumAddress),
            eq(auctionAgentAuthorization.active, true),
            gt(auctionAgentAuthorization.authorizedAt, since),
          ),
        ),
    ]);
  items.push(
    ...authorizationNotificationItems(
      marketplaceAuthorizations,
      "agent.authorized",
      checksumAddress,
      since,
    ),
    ...authorizationNotificationItems(
      auctionAuthorizations,
      "auction_agent.authorized",
      checksumAddress,
      since,
    ),
  );

  const claimCredits = await ponderDb
    .select()
    .from(claimCredit)
    .where(
      and(eq(claimCredit.account, checksumAddress), gt(claimCredit.timestamp, since)),
    )
    .orderBy(desc(claimCredit.timestamp))
    .limit(limit);

  items.push(
    ...claimRecordedNotificationItems(
      claimCredits.map((r) => ({
        id: r.id,
        chainId: r.chainId,
        contract: r.contract,
        account: r.account,
        asset: r.asset,
        amount: r.amount,
        reasonCode: r.reasonCode,
        timestamp: r.timestamp,
      })),
      checksumAddress,
      since,
    ),
  );

  const verifiedByMe = await ponderDb
    .select()
    .from(passport)
    .where(eq(passport.verifier, checksumAddress));

  for (const p of verifiedByMe) {
    if (p.disputeOpenedAt > since && p.disputeOpenedAt > 0n && p.status === "DISPUTED") {
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

  return items
    .sort((a, b) => {
      const diff = BigInt(b.timestamp) - BigInt(a.timestamp);
      if (diff > 0n) return 1;
      if (diff < 0n) return -1;
      return 0;
    })
    .slice(0, limit);
}
