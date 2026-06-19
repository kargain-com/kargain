import { passportGroupKey, ponderNotifId } from "@/lib/notifications/id";
import type { NotificationItem, NotificationType, PonderFeedItem } from "@/lib/notifications/types";

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
  "verifier.dispute_on_verified": {
    body: "A dispute was opened on a passport you verified",
    priority: "normal",
  },
};

function isHexAddress(value: string): value is `0x${string}` {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

function mapSingleItem(item: PonderFeedItem, lastSeenAtPonder: number): NotificationItem | null {
  const config = PONDER_TYPE_CONFIG[item.type];
  if (!config) return null;

  const timestamp = Number(item.timestamp);
  if (!Number.isFinite(timestamp)) return null;

  const type = item.type as NotificationType;
  const actor = item.actor && isHexAddress(item.actor) ? { address: item.actor } : undefined;

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
      title: `Passport #${item.tokenId}`,
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
): NotificationItem[] {
  return items
    .map((item) => mapSingleItem(item, lastSeenAtPonder))
    .filter((item): item is NotificationItem => item != null);
}
