"use client";

import { finalizeEvent } from "nostr-tools";

import {
  getNostrPool,
  NOSTR_RELAYS,
} from "@/lib/nostr/nostr-client";
import { pickLatestKind0Event } from "@/lib/nostr/pick-latest-kind0";
import { normalizeVerifierPaymentMethods } from "@/lib/nostr/payment-method-id";
import type { NostrProfileData } from "@/lib/nostr/parse-profile-content";
import type { AttestedProfileQueryPool } from "@/lib/nostr/resolve-attested-profile";

export const KARGAIN_MANAGED_KIND0_KEYS = [
  "name",
  "about",
  "picture",
  "website",
  "messagesEnabled",
  "lud16",
  "verifierPaymentMethods",
  // attestation is intentionally omitted — set only via publish param, preserved by spread
] as const;

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

/** Fetch latest kind:0 JSON object by author pubkey for merge-before-publish. */
export async function fetchLatestKind0RawByAuthor(
  pubkey: string,
  opts?: { pool?: AttestedProfileQueryPool; maxWait?: number },
): Promise<Record<string, unknown>> {
  try {
    const pool = opts?.pool ?? getNostrPool();
    const events = await pool.querySync(
      [...NOSTR_RELAYS],
      { kinds: [0], authors: [pubkey], limit: 20 },
      { maxWait: opts?.maxWait ?? 2500 },
    );
    const latest = pickLatestKind0Event(events);
    if (latest?.content != null) return parseKind0RawObject(latest.content);
    return {};
  } catch {
    return {};
  }
}

/** True when caller expects an existing relay profile but the merge base fetch returned nothing. */
export function isMergeBaseUnavailable(
  existing: Record<string, unknown>,
  expectExisting: boolean,
): boolean {
  return expectExisting && Object.keys(existing).length === 0;
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
