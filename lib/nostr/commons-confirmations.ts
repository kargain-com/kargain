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
  buildCommonsConfirmationEvent,
  commonsConfirmationFromEvent,
  COMMONS_CONFIRMATION_KIND,
  type CommonsConfirmation,
} from "@/lib/vincent-commons/confirmation";

const MAX_CONFIRMATION_QUERY_LIMIT = 2000;

/** Single choke point for kind 31862 queries by manifestHash `d` tags. */
export function commonsConfirmationFilterForManifests(
  manifestHashes: string[],
): Filter {
  const dTags = [...new Set(manifestHashes)];
  return {
    kinds: [COMMONS_CONFIRMATION_KIND],
    "#d": dTags,
    limit: Math.min(Math.max(dTags.length, 1) * 8, MAX_CONFIRMATION_QUERY_LIMIT),
  };
}

export type CommonsConfirmationEntry = {
  confirmation: CommonsConfirmation;
  createdAt: number;
  eventId: string;
  authorPubkey: string;
};

/**
 * Fail-closed verify+map for one kind 31862 event (signature, envelope, and
 * kind checks in `commonsConfirmationFromEvent`). Keeping the newest
 * confirmation per (author, manifest) is the shared latest-per-author-per-d
 * merge in lib/nostr/live-policy-subscription.ts — `d` = manifest, enforced
 * on parse. Author↔attester binding is a caller concern (as with reviews).
 */
export function commonsConfirmationEntryFromEvent(
  event: Pick<Event, "id" | "pubkey" | "kind" | "tags" | "content" | "created_at">,
): CommonsConfirmationEntry | null {
  const confirmation = commonsConfirmationFromEvent(event);
  if (!confirmation) return null;
  return {
    confirmation,
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
 * Publish a signed Commons confirmation as a kind 31862 event
 * (d = manifestHash). Fail-closed boolean — callers roll back optimistic
 * state on `false`.
 */
export async function publishCommonsConfirmation(
  confirmation: CommonsConfirmation,
  nostrPrivateKey: string,
): Promise<boolean> {
  if (!nostrPrivateKey.trim()) return false;
  const pubkey = pubkeyFromPrivateKey(nostrPrivateKey);

  return runSerializedPubkeyWrite(pubkey, async () => {
    try {
      const pool = getDefaultNostrPool();
      const template = buildCommonsConfirmationEvent(
        confirmation,
        Math.floor(Date.now() / 1000),
      );
      const signed = finalizeEvent(template, toPrivateKeyBytes(nostrPrivateKey));
      const result = await publishSignedEvent(pool, signed);
      return result.ok;
    } catch {
      return false;
    }
  });
}
