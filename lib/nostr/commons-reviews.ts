"use client";

import { hexToBytes } from "viem";
import { finalizeEvent, type Event, type Filter } from "nostr-tools";

import {
  getDefaultNostrPool,
  pubkeyFromPrivateKey,
  runSerializedPubkeyWrite,
} from "@/lib/nostr/app-event-store";
import { publishSignedEvent } from "@/lib/nostr/publish-event";
import {
  buildCommonsReviewEvent,
  commonsReviewFromEvent,
  COMMONS_REVIEW_KIND,
  type CommonsReview,
} from "@/lib/vincent-commons/review";

const MAX_REVIEW_QUERY_LIMIT = 2000;

/** Single choke point for kind 31860 queries by claimHash `d` tags. */
export function commonsReviewFilterForClaims(claimHashes: string[]): Filter {
  const dTags = [...new Set(claimHashes)];
  return {
    kinds: [COMMONS_REVIEW_KIND],
    "#d": dTags,
    limit: Math.min(Math.max(dTags.length, 1) * 8, MAX_REVIEW_QUERY_LIMIT),
  };
}

export type CommonsReviewEntry = {
  review: CommonsReview;
  createdAt: number;
  eventId: string;
  authorPubkey: string;
};

/**
 * Fail-closed verify+map for one kind 31860 event (signature, envelope, and
 * kind checks in `commonsReviewFromEvent`). Keeping the newest review per
 * (author, claim) is the shared latest-per-author-per-d merge in
 * lib/nostr/live-policy-subscription.ts — `d` = claim, enforced on parse.
 */
export function commonsReviewEntryFromEvent(
  event: Pick<Event, "id" | "pubkey" | "kind" | "tags" | "content" | "created_at">,
): CommonsReviewEntry | null {
  const review = commonsReviewFromEvent(event);
  if (!review) return null;
  return {
    review,
    createdAt: event.created_at,
    eventId: event.id,
    authorPubkey: event.pubkey,
  };
}

function toPrivateKeyBytes(privateKey: string): Uint8Array {
  const hex = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  return hexToBytes(hex as `0x${string}`);
}

/**
 * Publish a signed Commons review as a kind 31860 event (d = claimHash).
 * Fail-closed boolean — callers roll back optimistic state on `false`.
 */
export async function publishCommonsReview(
  review: CommonsReview,
  nostrPrivateKey: string,
): Promise<boolean> {
  if (!nostrPrivateKey.trim()) return false;
  const pubkey = pubkeyFromPrivateKey(nostrPrivateKey);

  return runSerializedPubkeyWrite(pubkey, async () => {
    try {
      const pool = getDefaultNostrPool();
      const template = buildCommonsReviewEvent(review, Math.floor(Date.now() / 1000));
      const signed = finalizeEvent(template, toPrivateKeyBytes(nostrPrivateKey));
      const result = await publishSignedEvent(pool, signed);
      return result.ok;
    } catch {
      return false;
    }
  });
}
