/**
 * Sole owner of composer drafts staged before the user sends.
 * Entry points may prefill; only the thread composer transmits on Send.
 * Persistence is owned by cache-adapter (`messaging:compose-draft:` keys).
 */

import {
  takeStoredComposeDraft,
  writeComposeDraft,
} from "@/lib/messaging/adapters/cache-adapter";
import { formatPassportTitle } from "@/lib/passport/passport-token-id";

export function buildListingInquiryDraft(tokenId: string): string {
  return `Hi, I'm interested in your listing for ${formatPassportTitle(tokenId)}.`;
}

export function setComposeDraft(conversationId: string, text: string): void {
  writeComposeDraft(conversationId, text);
}

/** Read and clear a staged draft for this conversation (once). */
export function takeComposeDraft(conversationId: string): string | null {
  return takeStoredComposeDraft(conversationId);
}
