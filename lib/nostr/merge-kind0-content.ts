"use client";

import {
  fetchRelayCoverage,
  getDefaultNostrPool,
  type AppEventQueryPool,
  type AppEventRelayReadResult,
} from "@/lib/nostr/app-event-store";
import { pickLatestKind0Event } from "@/lib/nostr/pick-latest-kind0";
import { normalizeVerifierPaymentMethods } from "@/lib/nostr/payment-method-id";
import type { NostrProfileData } from "@/lib/nostr/parse-profile-content";
import {
  isCompletePlaceSelection,
  placeSelectionToWire,
} from "@/lib/geo/place-selection";

export const KARGAIN_MANAGED_KIND0_KEYS = [
  "name",
  "about",
  "picture",
  "website",
  "messagesEnabled",
  "lud16",
  "verifierPaymentMethods",
  "location",
  // attestation is intentionally omitted — set only via publish param, preserved by spread
] as const;

export type Kind0MergeReadResult =
  | {
      status: "answered";
      content: Record<string, unknown>;
      answeredRelays: string[];
    }
  | { status: "unanswered"; cause: "no-relay-answered" };

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

/**
 * Coverage-aware kind:0 merge-base read by author pubkey.
 * Uses the sole {@link fetchRelayCoverage} owner — never `querySync`.
 */
export async function fetchLatestKind0RawByAuthor(
  pubkey: string,
  opts?: { pool?: AppEventQueryPool },
): Promise<Kind0MergeReadResult> {
  if (!pubkey.trim()) {
    return { status: "unanswered", cause: "no-relay-answered" };
  }

  try {
    const pool = opts?.pool ?? getDefaultNostrPool();
    const coverage: AppEventRelayReadResult = await fetchRelayCoverage(pool, {
      kinds: [0],
      authors: [pubkey],
      limit: 20,
    });
    if (coverage.status === "unanswered") {
      return coverage;
    }
    const latest = pickLatestKind0Event(coverage.events);
    const content =
      latest?.content != null ? parseKind0RawObject(latest.content) : {};
    return {
      status: "answered",
      content,
      answeredRelays: coverage.answeredRelays,
    };
  } catch {
    return { status: "unanswered", cause: "no-relay-answered" };
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

  if ("location" in patch) {
    const loc = patch.location;
    if (loc != null && isCompletePlaceSelection(loc)) {
      merged.location = placeSelectionToWire(loc);
    } else {
      delete merged.location;
    }
  }

  return merged;
}
