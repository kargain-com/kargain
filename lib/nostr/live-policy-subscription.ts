"use client";

import { useEffect, useState } from "react";
import type { Event, Filter } from "nostr-tools";

import {
  mergeLatestPerAuthorPerD,
  type LatestPerAuthorPerDPolicy,
} from "@/lib/nostr/app-event-store";
import { getNostrPool, NOSTR_RELAYS } from "@/lib/nostr/nostr-client";

const INITIAL_LOAD_TIMEOUT_MS = 3000;
const PROGRESSIVE_FLUSH_MS = 120;

/** Structural subset of SimplePool used by the live subscription engine. */
export type LiveSubscribePool = {
  subscribeMany: (
    relays: string[],
    filter: Filter,
    params: {
      onevent: (event: Event) => void;
      oneose?: () => void;
      onclose?: (reasons: string[]) => void;
    },
  ) => { close: () => void };
};

export type LivePolicySubscriptionTiming = {
  progressiveFlushMs?: number;
  initialLoadTimeoutMs?: number;
};

export type LivePolicySubscriptionCallbacks<T> = {
  /** Latest merged+mapped entries (insertion-ordered per (author, d) key). */
  onEntries: (entries: T[]) => void;
  /** Initial load settled — EOSE, relay close, or the safety timeout. */
  onInitialLoadDone: () => void;
};

/**
 * Live Nostr subscription for a `latest-per-author-per-d` app-event policy
 * (lib/nostr/app-event-store.ts). The single merge implementation: winner
 * selection per (author, d) delegates to the store's
 * `mergeLatestPerAuthorPerD` (newest `created_at`; NIP-01 tie keeps the
 * lower id). `mapEvent` is the fail-closed domain gate — events it rejects
 * never enter the merge, so an invalid newer event cannot displace a valid
 * older one.
 *
 * Emission cadence mirrors the pre-refactor commons hooks: a progressive
 * flush while the initial load streams in, a settle on EOSE/close/timeout,
 * then immediate emission per accepted live event.
 */
export function subscribeLatestPerAuthorPerD<T>(
  pool: LiveSubscribePool,
  relays: string[],
  filter: Filter,
  policy: LatestPerAuthorPerDPolicy,
  mapEvent: (event: Event) => T | null,
  callbacks: LivePolicySubscriptionCallbacks<T>,
  timing?: LivePolicySubscriptionTiming,
): () => void {
  const progressiveFlushMs = timing?.progressiveFlushMs ?? PROGRESSIVE_FLUSH_MS;
  const initialLoadTimeoutMs =
    timing?.initialLoadTimeoutMs ?? INITIAL_LOAD_TIMEOUT_MS;

  const byKey = new Map<string, { event: Event; value: T }>();

  let closed = false;
  let initialDone = false;
  let progressiveTimer: ReturnType<typeof setTimeout> | null = null;

  const emitEntries = () => {
    if (closed) return;
    callbacks.onEntries([...byKey.values()].map((kept) => kept.value));
  };

  const scheduleProgressiveFlush = () => {
    if (initialDone || progressiveTimer != null) return;
    progressiveTimer = setTimeout(() => {
      progressiveTimer = null;
      if (closed || initialDone) return;
      emitEntries();
    }, progressiveFlushMs);
  };

  const finishInitialLoad = () => {
    if (closed || initialDone) return;
    initialDone = true;
    if (progressiveTimer != null) {
      clearTimeout(progressiveTimer);
      progressiveTimer = null;
    }
    emitEntries();
    callbacks.onInitialLoadDone();
  };

  const applyEvent = (event: Event): boolean => {
    if (event.kind !== policy.kind) return false;
    const value = mapEvent(event);
    if (value === null) return false;

    const dTag = event.tags.find((tag) => tag[0] === "d")?.[1] ?? "";
    const key = `${event.pubkey}\u0000${dTag}`;
    const prev = byKey.get(key);
    if (prev) {
      const [kept] = mergeLatestPerAuthorPerD([prev.event, event]);
      if (kept !== event) return false;
    }
    byKey.set(key, { event, value });
    return true;
  };

  const sub = pool.subscribeMany(relays, filter, {
    onevent: (event) => {
      if (closed || !applyEvent(event)) return;
      if (!initialDone) {
        scheduleProgressiveFlush();
      } else {
        emitEntries();
      }
    },
    oneose: finishInitialLoad,
    onclose: () => {
      finishInitialLoad();
    },
  });

  const timeout = setTimeout(finishInitialLoad, initialLoadTimeoutMs);

  return () => {
    closed = true;
    clearTimeout(timeout);
    if (progressiveTimer != null) clearTimeout(progressiveTimer);
    try {
      sub.close();
    } catch {
      // ignore
    }
  };
}

/**
 * Generic live view over a `latest-per-author-per-d` policy. `buildFilter`
 * and `mapEvent` must be stable (module-scope) functions — the subscription
 * restarts only when `subscriptionKey` changes. Empty key ⇒ no subscription,
 * `loading: false`.
 */
export function useLatestPerAuthorPerDEntries<T>(
  subscriptionKey: string,
  buildFilter: (subscriptionKey: string) => Filter,
  policy: LatestPerAuthorPerDPolicy,
  mapEvent: (event: Event) => T | null,
): { entries: T[]; loading: boolean } {
  const [entries, setEntries] = useState<T[]>([]);
  const [loading, setLoading] = useState(Boolean(subscriptionKey));

  const [prevSubscriptionKey, setPrevSubscriptionKey] = useState(subscriptionKey);
  if (subscriptionKey !== prevSubscriptionKey) {
    setPrevSubscriptionKey(subscriptionKey);
    setEntries([]);
    setLoading(Boolean(subscriptionKey));
  }

  useEffect(() => {
    if (!subscriptionKey) return;

    return subscribeLatestPerAuthorPerD(
      getNostrPool(),
      [...NOSTR_RELAYS],
      buildFilter(subscriptionKey),
      policy,
      mapEvent,
      {
        onEntries: (next) => {
          setEntries(next);
          setLoading(false);
        },
        onInitialLoadDone: () => {
          setLoading(false);
        },
      },
    );
  }, [subscriptionKey, buildFilter, policy, mapEvent]);

  return { entries, loading };
}
