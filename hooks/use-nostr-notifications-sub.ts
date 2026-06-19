"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Event, Filter } from "nostr-tools";
import { useAccount } from "wagmi";

import { useNotificationState } from "@/hooks/use-notification-state";
import { useNostrKey } from "@/hooks/use-nostr-key";
import { mapNostrEventToNotification } from "@/lib/notifications/map-nostr-event";
import type { NotificationItem } from "@/lib/notifications/types";
import { getNostrPool, NOSTR_RELAYS, nostrPubkeyFromPrivateKey } from "@/lib/nostr/nostr-client";

const LOOKBACK_SECONDS = 7 * 24 * 3600;

function mergeEvents(existing: Event[], incoming: Event[]): Event[] {
  const byId = new Map(existing.map((ev) => [ev.id, ev]));
  for (const ev of incoming) {
    byId.set(ev.id, ev);
  }
  return [...byId.values()];
}

function buildFilters(pubkey: string, ownedTokenIds: string[], since: number): Filter[] {
  const filters: Filter[] = [
    { kinds: [1], "#p": [pubkey], since },
    { kinds: [7], "#p": [pubkey], since },
  ];

  if (ownedTokenIds.length > 0) {
    filters.push({
      kinds: [1],
      "#d": ownedTokenIds.map((id) => `listing:${id}`),
      since,
    });
  }

  return filters;
}

export function useNostrNotificationsSub(ownedTokenIds: string[]): {
  items: NotificationItem[];
} {
  const { isConnected } = useAccount();
  const { nostrPrivateKey } = useNostrKey();
  const { state } = useNotificationState();
  const [events, setEvents] = useState<Event[]>([]);
  const mountedRef = useRef(true);

  const pubkey = useMemo(
    () => (nostrPrivateKey ? nostrPubkeyFromPrivateKey(nostrPrivateKey) : null),
    [nostrPrivateKey],
  );

  const ready = isConnected && Boolean(nostrPrivateKey) && Boolean(pubkey);
  const ownedTokenIdsKey = ownedTokenIds.join("\0");

  useEffect(() => {
    if (!ready || !pubkey) {
      setEvents((prev) => (prev.length === 0 ? prev : []));
      return;
    }

    mountedRef.current = true;
    const pool = getNostrPool();
    const sinceLive = state.lastSeenAt.nostr;
    const sinceBackfill = Math.max(0, state.lastSeenAt.nostr - LOOKBACK_SECONDS);
    const liveFilters = buildFilters(pubkey, ownedTokenIds, sinceLive);
    const backfillFilters = buildFilters(pubkey, ownedTokenIds, sinceBackfill);

    void Promise.all(
      backfillFilters.map((filter) =>
        pool.querySync([...NOSTR_RELAYS], filter, { maxWait: 4500 }),
      ),
    )
      .then((results) => {
        if (!mountedRef.current) return;
        const merged = results.flat();
        setEvents((prev) => mergeEvents(prev, merged));
      })
      .catch((err) => {
        console.error("useNostrNotificationsSub backfill failed", err);
      });

    const subs = liveFilters.map((filter) =>
      pool.subscribeMany([...NOSTR_RELAYS], filter, {
        onevent: (ev: Event) => {
          setEvents((prev) => mergeEvents(prev, [ev]));
        },
      }),
    );

    return () => {
      mountedRef.current = false;
      for (const sub of subs) {
        try {
          sub.close();
        } catch {
          // ignore
        }
      }
    };
  }, [ready, pubkey, state.lastSeenAt.nostr, ownedTokenIdsKey]);

  const items = useMemo(() => {
    if (!pubkey) return [];
    return events
      .map((ev) => mapNostrEventToNotification(ev, pubkey, state.lastSeenAt.nostr))
      .filter((item): item is NotificationItem => item != null);
  }, [events, pubkey, state.lastSeenAt.nostr]);

  return { items };
}
