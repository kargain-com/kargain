"use client";

import { hexToBytes } from "viem";
import { finalizeEvent } from "nostr-tools";

import {
  fetchRelayCoverage,
  getDefaultNostrPool,
  pubkeyFromPrivateKey,
  runSerializedPubkeyWrite,
  type AppEventQueryPool,
} from "@/lib/nostr/app-event-store";
import { publishSignedEvent } from "@/lib/nostr/publish-event";

export type NotificationLastSeenAt = {
  ponder: number;
  nostr: number;
  watchlist: number;
};

export type NotificationState = {
  lastSeenAt: NotificationLastSeenAt;
};

export type NotificationRelayReadResult =
  | {
      status: "answered";
      state: NotificationState;
      answeredRelays: string[];
    }
  | { status: "unanswered"; cause: "no-relay-answered" };

const DEFAULT_STATE: NotificationState = {
  lastSeenAt: { ponder: 0, nostr: 0, watchlist: 0 },
};

const NOTIFICATION_STATE_D = "kargain-notifications-v1";
const KIND_APP_DATA = 30078;

function toPrivateKeyBytes(privateKey: string): Uint8Array {
  const hex = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  return hexToBytes(hex as `0x${string}`);
}

function normalizeChannel(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function normalizeState(raw: unknown): NotificationState {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return DEFAULT_STATE;
  }
  const obj = raw as Record<string, unknown>;
  const lastSeenRaw = obj.lastSeenAt;
  if (lastSeenRaw == null || typeof lastSeenRaw !== "object" || Array.isArray(lastSeenRaw)) {
    return DEFAULT_STATE;
  }
  const channels = lastSeenRaw as Record<string, unknown>;
  return {
    lastSeenAt: {
      ponder: normalizeChannel(channels.ponder),
      nostr: normalizeChannel(channels.nostr),
      watchlist: normalizeChannel(channels.watchlist),
    },
  };
}

/**
 * Parse relay content. Accepts plaintext NotificationState JSON.
 * Legacy address-AES envelopes ({ v, iv, cipher }) are ignored — fail closed to default.
 */
function parseRelayContent(content: string): NotificationState | null {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const obj = parsed as Record<string, unknown>;
    // Former fake-crypto envelope — not readable without the deleted address key.
    if ("iv" in obj && "cipher" in obj) return null;
    if (!("lastSeenAt" in obj)) return null;
    return normalizeState(parsed);
  } catch {
    return null;
  }
}

/** Merge two states: take max() per channel. Pure function. */
export function mergeNotificationStates(
  local: NotificationState,
  remote: NotificationState,
): NotificationState {
  const a = normalizeState(local);
  const b = normalizeState(remote);
  return {
    lastSeenAt: {
      ponder: Math.max(a.lastSeenAt.ponder, b.lastSeenAt.ponder),
      nostr: Math.max(a.lastSeenAt.nostr, b.lastSeenAt.nostr),
      watchlist: Math.max(a.lastSeenAt.watchlist, b.lastSeenAt.watchlist),
    },
  };
}

/**
 * Coverage-aware kind 30078 merge-base read.
 * Uses the sole {@link fetchRelayCoverage} owner — never `querySync`.
 */
export async function loadNotificationState(
  pubkey: string,
  opts?: { pool?: AppEventQueryPool },
): Promise<NotificationRelayReadResult> {
  if (!pubkey.trim()) {
    return { status: "unanswered", cause: "no-relay-answered" };
  }

  try {
    const pool = opts?.pool ?? getDefaultNostrPool();
    const coverage = await fetchRelayCoverage(pool, {
      kinds: [KIND_APP_DATA],
      authors: [pubkey],
      "#d": [NOTIFICATION_STATE_D],
      limit: 5,
    });
    if (coverage.status === "unanswered") {
      return coverage;
    }

    if (coverage.events.length === 0) {
      return {
        status: "answered",
        state: DEFAULT_STATE,
        answeredRelays: coverage.answeredRelays,
      };
    }

    const latest = [...coverage.events].sort((a, b) => b.created_at - a.created_at)[0];
    if (!latest?.content) {
      return {
        status: "answered",
        state: DEFAULT_STATE,
        answeredRelays: coverage.answeredRelays,
      };
    }

    const remote = parseRelayContent(latest.content);
    return {
      status: "answered",
      state: remote ?? DEFAULT_STATE,
      answeredRelays: coverage.answeredRelays,
    };
  } catch {
    return { status: "unanswered", cause: "no-relay-answered" };
  }
}

/**
 * Coverage-aware kind 30078 full replacement: read → max-merge → publish to answered.
 * Unanswered coverage skips publish (local floor stays authoritative for this device).
 * Serialized per pubkey so debounced saves cannot interleave.
 */
export async function saveNotificationState(
  state: NotificationState,
  privateKey: string,
): Promise<void> {
  try {
    if (!privateKey.trim()) return;
    const pubkey = pubkeyFromPrivateKey(privateKey);

    await runSerializedPubkeyWrite(pubkey, async () => {
      const base = await loadNotificationState(pubkey);
      if (base.status === "unanswered") return;

      const toPublish = mergeNotificationStates(state, base.state);
      const content = JSON.stringify(normalizeState(toPublish));

      const unsigned = {
        kind: KIND_APP_DATA,
        created_at: Math.floor(Date.now() / 1000),
        content,
        tags: [["d", NOTIFICATION_STATE_D]] as string[][],
      };
      const signed = finalizeEvent(unsigned, toPrivateKeyBytes(privateKey));
      const pool = getDefaultNostrPool();
      await publishSignedEvent(pool, signed, { relays: base.answeredRelays });
    });
  } catch {
    // Never throws — local floor remains authoritative for this device.
  }
}
