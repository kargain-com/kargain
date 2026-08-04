/**
 * Sole owner of composer drafts staged before the user sends.
 * Entry points may prefill; only the thread composer transmits on Send.
 * Persistence is owned by cache-adapter (`messaging:compose-draft:` keys).
 *
 * Render must stay pure: peek into React state, clear storage after commit.
 * A tab-scoped memory seed survives StrictMode remount after storage clear.
 */

import {
  clearStoredComposeDraft,
  peekStoredComposeDraft,
  writeComposeDraft,
} from "@/lib/messaging/adapters/cache-adapter";
import { formatPassportTitle } from "@/lib/passport/passport-token-id";

/** Survives StrictMode remount after storage was cleared on first commit. */
const mountSeeds = new Map<string, string>();

export function buildListingInquiryDraft(tokenId: string): string {
  return `Hi, I'm interested in your listing for ${formatPassportTitle(tokenId)}.`;
}

export function setComposeDraft(conversationId: string, text: string): void {
  mountSeeds.delete(conversationId);
  writeComposeDraft(conversationId, text);
}

/** Pure read for render / useState initializers — does not mutate storage. */
export function peekComposeDraft(conversationId: string): string | null {
  const cached = mountSeeds.get(conversationId);
  if (cached !== undefined) return cached;
  const fromStore = peekStoredComposeDraft(conversationId);
  if (fromStore) mountSeeds.set(conversationId, fromStore);
  return fromStore;
}

/**
 * Drop the browser/memory storage copy after the draft is committed to React state.
 * Keeps `mountSeeds` so a StrictMode remount can re-initialize from memory.
 */
export function clearComposeDraftStorage(conversationId: string): void {
  clearStoredComposeDraft(conversationId);
}

/** Test helper — reset mount seeds (pairs with cache-adapter clearComposeDraftsForTest). */
export function clearComposeDraftMountSeedsForTest(): void {
  mountSeeds.clear();
}
