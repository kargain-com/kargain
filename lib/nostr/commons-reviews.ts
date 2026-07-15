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

export type CommonsReviewBatchState = {
  /** `${authorPubkey}\u0000${claim}` → latest signature-verified entry */
  byAuthorClaim: Map<string, CommonsReviewEntry>;
};

export function createEmptyCommonsReviewState(): CommonsReviewBatchState {
  return { byAuthorClaim: new Map() };
}

/**
 * Apply one incoming event: signature-verify (fail-closed), then keep the
 * newest review per (author, claim) — NIP-01 tie resolves to the lower id.
 */
export function applyCommonsReviewEvent(
  state: CommonsReviewBatchState,
  event: Pick<Event, "id" | "pubkey" | "kind" | "tags" | "content" | "created_at">,
): CommonsReviewBatchState {
  const review = commonsReviewFromEvent(event);
  if (!review) return state;

  const key = `${event.pubkey}\u0000${review.claim}`;
  const prev = state.byAuthorClaim.get(key);
  if (
    prev &&
    (prev.createdAt > event.created_at ||
      (prev.createdAt === event.created_at && prev.eventId <= event.id))
  ) {
    return state;
  }

  const next = new Map(state.byAuthorClaim);
  next.set(key, {
    review,
    createdAt: event.created_at,
    eventId: event.id,
    authorPubkey: event.pubkey,
  });
  return { byAuthorClaim: next };
}

export function commonsReviewEntries(
  state: CommonsReviewBatchState,
): CommonsReviewEntry[] {
  return [...state.byAuthorClaim.values()];
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
