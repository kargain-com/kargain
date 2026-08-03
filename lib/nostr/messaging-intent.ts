"use client";

import type { Address } from "viem";

import { fetchLatestKind0RawByAuthor } from "@/lib/nostr/merge-kind0-content";
import { loadCachedPubkey } from "@/lib/nostr/nostr-pubkey-cache";
import { publishNostrProfile } from "@/lib/nostr/profile";
import { attestedPubkeyForAddress } from "@/lib/nostr/resolve-attested-profile";

/**
 * Sole owner of the published messaging flag (`messagesEnabled` on kind:0).
 * Reads through coverage; writes through the single kind:0 publisher.
 */

export type MessagingIntentReadResult =
  | {
      status: "answered";
      intent: true | false | null;
      answeredRelays: string[];
    }
  | { status: "unanswered" };

function parseMessagesEnabled(content: Record<string, unknown>): true | false | null {
  if (content.messagesEnabled === true) return true;
  if (content.messagesEnabled === false) return false;
  return null;
}

async function resolveAuthorPubkey(
  address: `0x${string}`,
): Promise<string | null> {
  const cached = loadCachedPubkey(address);
  if (cached) return cached;
  return attestedPubkeyForAddress(address);
}

/**
 * Coverage-aware read of `messagesEnabled` for a wallet.
 * Unanswered is not a flag value — no relay completed end-of-stream (or pubkey unknown).
 */
export async function readMessagingIntent(
  walletAddress: Address,
): Promise<MessagingIntentReadResult> {
  try {
    const address = walletAddress as `0x${string}`;
    const pubkey = await resolveAuthorPubkey(address);
    if (!pubkey) {
      return { status: "unanswered" };
    }
    const base = await fetchLatestKind0RawByAuthor(pubkey);
    if (base.status === "unanswered") {
      return { status: "unanswered" };
    }
    return {
      status: "answered",
      intent: parseMessagesEnabled(base.content),
      answeredRelays: base.answeredRelays,
    };
  } catch {
    return { status: "unanswered" };
  }
}

/**
 * Publish `messagesEnabled` via the sole kind:0 writer (serialized, one coverage).
 */
export async function publishMessagingIntent(
  walletAddress: Address,
  enabled: boolean,
  signer: { signMessage: (msg: string) => Promise<string> },
): Promise<boolean> {
  return publishNostrProfile({ messagesEnabled: enabled }, walletAddress, signer);
}
