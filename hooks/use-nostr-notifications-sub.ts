"use client";

import { useActiveAccount, requireEvmSession } from "@/hooks/use-active-account";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Event } from "nostr-tools";

import { useNotificationState } from "@/hooks/use-notification-state";
import { useNostrKey } from "@/hooks/use-nostr-key";
import { createDebouncedNostrEventBuffer } from "@/lib/nostr/batch-nostr-live-events";
import { mapNostrEventToNotification } from "@/lib/notifications/map-nostr-event";
import { buildNostrNotificationFilters } from "@/lib/notifications/nostr-notification-filters";
import type { NotificationItem } from "@/lib/notifications/types";
import { getNostrPool, NOSTR_RELAYS } from "@/lib/nostr/nostr-client";

const LOOKBACK_SECONDS = 7 * 24 * 3600;

function mergeEvents(existing: Event[], incoming: Event[]): Event[] {
  const byId = new Map(existing.map((ev) => [ev.id, ev]));
  for (const ev of incoming) {
    byId.set(ev.id, ev);
  }
  return [...byId.values()];
}

export function useNostrNotificationsSub(ownedTokenIds: string[]): {
  items: NotificationItem[];
  isLoading: boolean;
} {
  const { account } = useActiveAccount();
  const evm = requireEvmSession(account);
  const isConnected = evm.ok;
  const { nostrPubkey } = useNostrKey();
  const { state } = useNotificationState();
  const [events, setEvents] = useState<Event[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const mountedRef = useRef(true);

  const pubkey = nostrPubkey;
  const ready = isConnected && Boolean(pubkey);
  const ownedTokenIdsKey = ownedTokenIds.join("\0");
  const subscriptionKey = ready && pubkey
    ? `${pubkey}\0${ownedTokenIdsKey}\0${state.lastSeenAt.nostr}`
    : "";

  const [prevSubscriptionKey, setPrevSubscriptionKey] = useState(subscriptionKey);
  if (subscriptionKey !== prevSubscriptionKey) {
    setPrevSubscriptionKey(subscriptionKey);
    setEvents([]);
    setIsLoading(Boolean(subscriptionKey));
  }

  useEffect(() => {
    if (!subscriptionKey || !pubkey) return;

    mountedRef.current = true;

    const pool = getNostrPool();
    const sinceLive = state.lastSeenAt.nostr;
    const sinceBackfill = Math.max(0, state.lastSeenAt.nostr - LOOKBACK_SECONDS);
    const liveFilters = buildNostrNotificationFilters(pubkey, ownedTokenIds, sinceLive);
    const backfillFilters = buildNostrNotificationFilters(pubkey, ownedTokenIds, sinceBackfill);

    const liveBuffer = createDebouncedNostrEventBuffer<Event>((batch) => {
      if (!mountedRef.current) return;
      setEvents((prev) => mergeEvents(prev, batch));
    });

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
      })
      .finally(() => {
        if (mountedRef.current) setIsLoading(false);
      });

    const subs = liveFilters.map((filter) =>
      pool.subscribeMany([...NOSTR_RELAYS], filter, {
        onevent: (ev: Event) => {
          liveBuffer.push(ev);
        },
      }),
    );

    return () => {
      mountedRef.current = false;
      liveBuffer.clear();
      for (const sub of subs) {
        try {
          sub.close();
        } catch {
          // ignore
        }
      }
    };
  }, [subscriptionKey, pubkey, ownedTokenIds, state.lastSeenAt.nostr]);

  const items = useMemo(() => {
    if (!pubkey) return [];
    return events
      .map((ev) => mapNostrEventToNotification(ev, pubkey, state.lastSeenAt.nostr))
      .filter((item): item is NotificationItem => item != null);
  }, [events, pubkey, state.lastSeenAt.nostr]);

  return { items, isLoading };
}
