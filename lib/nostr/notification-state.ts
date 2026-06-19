"use client";

import { hexToBytes } from "viem";
import { finalizeEvent } from "nostr-tools";

import { decryptAppPayload, encryptAppPayload } from "@/lib/nostr/key-manager";
import { getNostrPool, NOSTR_RELAYS } from "@/lib/nostr/nostr-client";

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

type ContentEnvelope = {
  v: number;
  iv: string;
  cipher: string;
};

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

function parseContentEnvelope(content: string): ContentEnvelope | null {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (parsed.v !== 1) return null;
    if (typeof parsed.iv !== "string" || typeof parsed.cipher !== "string") return null;
    return { v: 1, iv: parsed.iv, cipher: parsed.cipher };
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
export async function loadNotificationState(
  address: `0x${string}`,
  pubkey: string,
  privateKey: string,
): Promise<NotificationState> {
  try {
    if (!pubkey.trim() || !privateKey.trim()) return DEFAULT_STATE;

    const pool = getNostrPool();
    const events = await pool.querySync(
      [...NOSTR_RELAYS],
      { kinds: [KIND_APP_DATA], authors: [pubkey], "#d": [NOTIFICATION_STATE_D], limit: 5 },
      { maxWait: 4500 },
    );
    if (events.length === 0) return DEFAULT_STATE;

    const latest = events.sort((a, b) => b.created_at - a.created_at)[0];
    if (!latest?.content) return DEFAULT_STATE;

    const envelope = parseContentEnvelope(latest.content);
    if (!envelope) return DEFAULT_STATE;

    const plaintext = await decryptAppPayload(address, envelope.iv, envelope.cipher);
    const parsed = JSON.parse(plaintext) as unknown;
    return mergeNotificationStates(DEFAULT_STATE, normalizeState(parsed));
  } catch (err) {
    console.error("loadNotificationState failed", err);
    return DEFAULT_STATE;
  }
}

/** Encrypt and publish kind 30078 replacement. Never throws. */
export async function saveNotificationState(
  address: `0x${string}`,
  state: NotificationState,
  privateKey: string,
): Promise<void> {
  try {
    if (!privateKey.trim()) return;

    const normalized = normalizeState(state);
    const { ivHex, cipherHex } = await encryptAppPayload(address, JSON.stringify(normalized));
    const content = JSON.stringify({ v: 1, iv: ivHex, cipher: cipherHex });

    const unsigned = {
      kind: KIND_APP_DATA,
      created_at: Math.floor(Date.now() / 1000),
      content,
      tags: [["d", NOTIFICATION_STATE_D]] as string[][],
    };
    const signed = finalizeEvent(unsigned, toPrivateKeyBytes(privateKey));
    const pool = getNostrPool();
    await Promise.any(pool.publish([...NOSTR_RELAYS], signed));
  } catch (err) {
    console.error("saveNotificationState failed", err);
  }
}
