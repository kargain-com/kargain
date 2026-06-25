"use client";

import type { NotificationState } from "@/lib/nostr/notification-state";

const LOCAL_STATE_PREFIX = "kargain-notif-local-v1:";

const DEFAULT_STATE: NotificationState = {
  lastSeenAt: { ponder: 0, nostr: 0, watchlist: 0 },
};

function cacheKey(address: `0x${string}`): string {
  return `${LOCAL_STATE_PREFIX}${address.toLowerCase()}`;
}

function requireBrowser(): boolean {
  return typeof window !== "undefined" && Boolean(window.localStorage);
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
  const normalizeChannel = (value: unknown): number => {
    const n = typeof value === "number" ? value : Number(value ?? 0);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  };
  return {
    lastSeenAt: {
      ponder: normalizeChannel(channels.ponder),
      nostr: normalizeChannel(channels.nostr),
      watchlist: normalizeChannel(channels.watchlist),
    },
  };
}

export function loadLocalNotificationState(address: `0x${string}`): NotificationState {
  if (!requireBrowser()) return DEFAULT_STATE;
  const raw = window.localStorage.getItem(cacheKey(address));
  if (!raw) return DEFAULT_STATE;
  try {
    return normalizeState(JSON.parse(raw) as unknown);
  } catch {
    return DEFAULT_STATE;
  }
}

export function saveLocalNotificationState(
  address: `0x${string}`,
  state: NotificationState,
): void {
  if (!requireBrowser()) return;
  window.localStorage.setItem(cacheKey(address), JSON.stringify(state));
}
