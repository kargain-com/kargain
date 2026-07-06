"use client";

import { type Address } from "viem";

import { loadDecryptedKey } from "@/lib/nostr/key-manager";
import {
  getNostrPool,
  NOSTR_RELAYS,
  nostrPubkeyFromPrivateKey,
} from "@/lib/nostr/nostr-client";
import { pickLatestKind0Event } from "@/lib/nostr/pick-latest-kind0";
import { normalizeVerifierPaymentMethods } from "@/lib/nostr/payment-method-id";
import type { NostrProfileData } from "@/lib/nostr/parse-profile-content";

export const KARGAIN_MANAGED_KIND0_KEYS = [
  "name",
  "about",
  "picture",
  "website",
  "messagesEnabled",
  "lud16",
  "verifierPaymentMethods",
] as const;

function toWalletAddress(address: Address): `0x${string}` {
  return address as `0x${string}`;
}

function parseKind0RawObject(content: string): Record<string, unknown> {
  if (!content.trim()) return {};
  try {
    const raw: unknown = JSON.parse(content);
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return {};
    return { ...(raw as Record<string, unknown>) };
  } catch {
    return {};
  }
}

async function fetchLatestKind0ContentByTag(
  address: `0x${string}`,
  maxWait: number,
): Promise<string | null> {
  const pool = getNostrPool();
  const tag = `ethereum:${address.toLowerCase()}`;
  const events = await pool.querySync(
    [...NOSTR_RELAYS],
    { kinds: [0], "#i": [tag], limit: 20 },
    { maxWait },
  );
  const latest = pickLatestKind0Event(events);
  return latest?.content ?? null;
}

async function fetchLatestKind0ContentByAuthor(
  pubkey: string,
  maxWait: number,
): Promise<string | null> {
  const pool = getNostrPool();
  const events = await pool.querySync(
    [...NOSTR_RELAYS],
    { kinds: [0], authors: [pubkey], limit: 20 },
    { maxWait },
  );
  const latest = pickLatestKind0Event(events);
  return latest?.content ?? null;
}

/** Fetch latest kind:0 JSON object for merge-before-publish. */
export async function fetchLatestKind0Raw(
  walletAddress: Address,
): Promise<Record<string, unknown>> {
  try {
    const address = toWalletAddress(walletAddress);
    const byTag = await fetchLatestKind0ContentByTag(address, 3000);
    if (byTag != null) return parseKind0RawObject(byTag);

    const storedKey = await loadDecryptedKey({
      address,
      signMessage: async () => "" as `0x${string}`,
    });
    if (!storedKey) return {};

    const pubkey = nostrPubkeyFromPrivateKey(storedKey);
    const byAuthor = await fetchLatestKind0ContentByAuthor(pubkey, 2500);
    if (byAuthor != null) return parseKind0RawObject(byAuthor);

    return {};
  } catch {
    return {};
  }
}

/** Merge relay content with a partial Kargain-managed patch (preserves unknown fields). */
export function mergeKind0Content(
  existing: Record<string, unknown>,
  patch: NostrProfileData,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...existing };

  const stringKeys = ["name", "about", "picture", "website", "lud16"] as const;
  for (const key of stringKeys) {
    if (!(key in patch)) continue;
    const val = patch[key];
    if (typeof val === "string" && val.trim()) {
      merged[key] = val.trim();
    } else {
      delete merged[key];
    }
  }

  if ("messagesEnabled" in patch) {
    if (patch.messagesEnabled === true) {
      merged.messagesEnabled = true;
    } else if (patch.messagesEnabled === false) {
      merged.messagesEnabled = false;
    } else {
      delete merged.messagesEnabled;
    }
  }

  if ("verifierPaymentMethods" in patch) {
    const methods = normalizeVerifierPaymentMethods(patch.verifierPaymentMethods);
    if (methods) {
      merged.verifierPaymentMethods = methods;
    } else {
      delete merged.verifierPaymentMethods;
    }
  }

  return merged;
}
