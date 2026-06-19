import type { Event } from "nostr-tools";

import { nostrGroupKey, nostrNotifId } from "@/lib/notifications/id";
import type { NotificationItem } from "@/lib/notifications/types";

const LISTING_TAG_PREFIX = "listing:";

function tagValue(event: Event, name: string): string | null {
  const tag = event.tags.find((t) => t[0] === name);
  return tag?.[1] ?? null;
}

function hasPubkeyTag(event: Event, pubkey: string): boolean {
  return event.tags.some((t) => t[0] === "p" && t[1] === pubkey);
}

function tokenIdFromListingTag(event: Event): string | null {
  const dTag = tagValue(event, "d");
  if (!dTag?.startsWith(LISTING_TAG_PREFIX)) return null;
  const tokenId = dTag.slice(LISTING_TAG_PREFIX.length);
  return tokenId.length > 0 ? tokenId : null;
}

function rootEventId(event: Event): string {
  const reply = event.tags.find((t) => t[0] === "e" && t[3] === "reply");
  if (reply?.[1]) return reply[1];
  return event.id;
}

export function mapNostrEventToNotification(
  event: Event,
  myPubkey: string,
  lastSeenAtNostr: number,
): NotificationItem | null {
  const timestamp = event.created_at;
  const read = timestamp <= lastSeenAtNostr;

  if (event.kind === 7 && hasPubkeyTag(event, myPubkey)) {
    const tokenId = tokenIdFromListingTag(event);
    return {
      id: nostrNotifId(event.kind, event.id),
      type: "nostr.like_on_comment",
      source: "nostr",
      timestamp,
      read,
      href: tokenId ? `/marketplace/${tokenId}` : "/notifications",
      subject: {
        kind: "comment",
        tokenId: tokenId ?? undefined,
        eventId: event.id,
        title: tokenId ? `Passport #${tokenId}` : "Comment",
      },
      actor: { nostrPubkey: event.pubkey },
      body: "Someone liked your comment",
      groupKey: nostrGroupKey(rootEventId(event)),
      priority: "low",
    };
  }

  if (event.kind === 1 && hasPubkeyTag(event, myPubkey)) {
    const tokenId = tokenIdFromListingTag(event);
    return {
      id: nostrNotifId(event.kind, event.id),
      type: "nostr.reply_to_comment",
      source: "nostr",
      timestamp,
      read,
      href: tokenId ? `/marketplace/${tokenId}` : "/notifications",
      subject: {
        kind: "comment",
        tokenId: tokenId ?? undefined,
        eventId: event.id,
        title: tokenId ? `Passport #${tokenId}` : "Comment",
      },
      actor: { nostrPubkey: event.pubkey },
      body: "Someone replied to your comment",
      groupKey: nostrGroupKey(rootEventId(event)),
      priority: "normal",
    };
  }

  if (event.kind === 1) {
    const tokenId = tokenIdFromListingTag(event);
    if (!tokenId) return null;
    if (hasPubkeyTag(event, myPubkey)) return null;

    return {
      id: nostrNotifId(event.kind, event.id),
      type: "nostr.comment_on_passport",
      source: "nostr",
      timestamp,
      read,
      href: `/marketplace/${tokenId}`,
      subject: {
        kind: "comment",
        tokenId,
        eventId: event.id,
        title: `Passport #${tokenId}`,
      },
      actor: { nostrPubkey: event.pubkey },
      body: "A new comment on your passport",
      groupKey: nostrGroupKey(event.id),
      priority: "normal",
    };
  }

  return null;
}
