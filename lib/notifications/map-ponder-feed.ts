import { formatPassportTitle } from "@/lib/passport/passport-token-id";
import { passportGroupKey, ponderNotifId } from "@/lib/notifications/id";
import type { NotificationItem, NotificationType, PonderFeedItem } from "@/lib/notifications/types";
import { claimNotificationBody } from "@/lib/claims/explain-credits";
import { isClaimReasonCode } from "@/lib/claims/reason";
import { zeroAddress } from "viem";

const PONDER_TYPE_CONFIG: Record<
  string,
  { body: string; priority: NotificationItem["priority"] }
> = {
  "passport.verified": { body: "Your passport was verified", priority: "high" },
  "passport.dispute_opened": { body: "A dispute was opened on your passport", priority: "high" },
  "passport.dispute_resolved": { body: "The dispute on your passport was resolved", priority: "normal" },
  "passport.record_appended": { body: "A new record was added to your passport", priority: "normal" },
  "passport.attestation_received": { body: "You received an attestation", priority: "high" },
  "listing.sold": { body: "Your listing was sold", priority: "high" },
  "agent.authorized": {
    body: "A vehicle was delegated to you for sale",
    priority: "high",
  },
  "auction_agent.authorized": {
    body: "You were authorized to run a reserve auction",
    priority: "high",
  },
  "claim.recorded": {
    body: "Funds are waiting for you to withdraw",
    priority: "high",
  },
  "verifier.dispute_on_verified": {
    body: "A dispute was opened on a passport you verified",
    priority: "normal",
  },
};

function isHexAddress(value: string): value is `0x${string}` {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

function claimBody(item: PonderFeedItem): string {
  const meta = item.meta ?? {};
  const reasonCode =
    typeof meta.reasonCode === "string" && isClaimReasonCode(meta.reasonCode)
      ? meta.reasonCode
      : "unknown";
  const amountRaw = meta.amount;
  const amount =
    typeof amountRaw === "string" || typeof amountRaw === "number"
      ? String(amountRaw)
      : null;
  const asset =
    typeof meta.asset === "string" && isHexAddress(meta.asset)
      ? meta.asset
      : zeroAddress;

  if (amount == null) {
    return PONDER_TYPE_CONFIG["claim.recorded"]!.body;
  }

  try {
    return claimNotificationBody({
      amount,
      asset,
      reasonCode,
      // Feed has no token metadata — native uses 18; ERC-20 fail-closed raw via null decimals.
      decimals: asset.toLowerCase() === zeroAddress ? 18 : null,
      nativeSymbol: "ETH",
    });
  } catch {
    return PONDER_TYPE_CONFIG["claim.recorded"]!.body;
  }
}

function mapSingleItem(
  item: PonderFeedItem,
  lastSeenAtPonder: number,
  viewerAddress?: string,
): NotificationItem | null {
  const config = PONDER_TYPE_CONFIG[item.type];
  if (!config) return null;

  const timestamp = Number(item.timestamp);
  if (!Number.isFinite(timestamp)) return null;

  const type = item.type as NotificationType;
  const actor = item.actor && isHexAddress(item.actor) ? { address: item.actor } : undefined;

  if (type === "claim.recorded") {
    const hrefAddress =
      viewerAddress && isHexAddress(viewerAddress)
        ? viewerAddress
        : typeof item.meta?.account === "string" && isHexAddress(item.meta.account)
          ? item.meta.account
          : null;
    return {
      id: item.id || ponderNotifId(item.type, item.tokenId, item.timestamp),
      type,
      source: "ponder",
      timestamp,
      read: timestamp <= lastSeenAtPonder,
      href: hrefAddress ? `/profile/${hrefAddress}?tab=claims` : "/notifications",
      subject: {
        kind: "claim",
        title: "Pending claim",
      },
      actor,
      body: claimBody(item),
      groupKey: `claim:${item.id}`,
      priority: config.priority,
    };
  }

  return {
    id: item.id || ponderNotifId(item.type, item.tokenId, item.timestamp),
    type,
    source: "ponder",
    timestamp,
    read: timestamp <= lastSeenAtPonder,
    href: `/marketplace/${item.tokenId}`,
    subject: {
      kind: "passport",
      tokenId: item.tokenId,
      title: formatPassportTitle(item.tokenId),
    },
    actor,
    body: config.body,
    groupKey: passportGroupKey(item.tokenId),
    priority: config.priority,
  };
}

export function mapPonderFeedItems(
  items: PonderFeedItem[],
  lastSeenAtPonder: number,
  viewerAddress?: string,
): NotificationItem[] {
  return items
    .map((item) => mapSingleItem(item, lastSeenAtPonder, viewerAddress))
    .filter((item): item is NotificationItem => item != null);
}
