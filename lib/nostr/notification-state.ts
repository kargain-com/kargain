"use client";

import { hexToBytes } from "viem";
import { finalizeEvent } from "nostr-tools";

import { getNostrPool, NOSTR_RELAYS } from "@/lib/nostr/nostr-client";
import { publishSignedEvent } from "@/lib/nostr/publish-event";

export type NotificationLastSeenAt = {
  ponder: number;
  nostr: number;
  watchlist: number;
};

export type NotificationState = {
  lastSeenAt: NotificationLastSeenAt;
};

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

/** Load state from NIP-78 relay. Never throws. Falls back to DEFAULT_STATE. */
export async function loadNotificationState(pubkey: string): Promise<NotificationState> {
  try {
    if (!pubkey.trim()) return DEFAULT_STATE;

    const pool = getNostrPool();
    const events = await pool.querySync(
      [...NOSTR_RELAYS],
      { kinds: [KIND_APP_DATA], authors: [pubkey], "#d": [NOTIFICATION_STATE_D], limit: 5 },
      { maxWait: 4500 },
    );
    if (events.length === 0) return DEFAULT_STATE;

    const latest = events.sort((a, b) => b.created_at - a.created_at)[0];
    if (!latest?.content) return DEFAULT_STATE;

    const remote = parseRelayContent(latest.content);
    if (!remote) return DEFAULT_STATE;

    return mergeNotificationStates(DEFAULT_STATE, remote);
  } catch (err) {
    console.error("loadNotificationState failed", err);
    return DEFAULT_STATE;
  }
}

/** Publish kind 30078 replacement as signed plaintext. Never throws. */
export async function saveNotificationState(
  state: NotificationState,
  privateKey: string,
): Promise<void> {
  try {
    if (!privateKey.trim()) return;

    const normalized = normalizeState(state);
    const content = JSON.stringify(normalized);

    const unsigned = {
      kind: KIND_APP_DATA,
      created_at: Math.floor(Date.now() / 1000),
      content,
      tags: [["d", NOTIFICATION_STATE_D]] as string[][],
    };
    const signed = finalizeEvent(unsigned, toPrivateKeyBytes(privateKey));
    const pool = getNostrPool();
    await publishSignedEvent(pool, signed);
  } catch (err) {
    console.error("saveNotificationState failed", err);
  }
}
