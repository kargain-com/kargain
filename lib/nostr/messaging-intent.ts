"use client";

import type { Address } from "viem";

import { fetchLatestKind0RawByAuthor } from "@/lib/nostr/merge-kind0-content";
import { loadCachedPubkey } from "@/lib/nostr/nostr-pubkey-cache";
import { verifyProfileAttestationCore } from "@/lib/nostr/profile-attestation";
import {
  publishKind0Profile,
  type PublishKind0ProfileOpts,
} from "@/lib/nostr/publish-kind0-profile";
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
 * Prompt-free check: coverage merge base already carries a verifying attestation.
 * Never prompts the wallet.
 */
export async function hasValidMessagingAttestation(
  walletAddress: Address,
): Promise<boolean> {
  try {
    const address = walletAddress as `0x${string}`;
    const pubkey = await resolveAuthorPubkey(address);
    if (!pubkey) return false;
    const base = await fetchLatestKind0RawByAuthor(pubkey);
    if (base.status === "unanswered") return false;
    return verifyProfileAttestationCore(
      { id: `probe:${pubkey}`, pubkey, content: JSON.stringify(base.content) },
      address,
    );
  } catch {
    return false;
  }
}

/**
 * Publish `messagesEnabled` via the key-injected kind:0 writer (no key-manager).
 * Caller must supply `privateKeyHex` from the app identity owner.
 */
export async function publishMessagingIntent(
  walletAddress: Address,
  enabled: boolean,
  signer: { signMessage: (msg: string) => Promise<string> },
  opts: { privateKeyHex: string } & PublishKind0ProfileOpts,
): Promise<boolean> {
  return publishKind0Profile(
    { messagesEnabled: enabled },
    walletAddress,
    opts.privateKeyHex,
    signer,
    { attestation: opts.attestation },
  );
}
