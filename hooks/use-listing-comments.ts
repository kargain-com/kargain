"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Filter } from "nostr-tools";

import { createDebouncedNostrEventBuffer } from "@/lib/nostr/batch-nostr-live-events";
import {
  applyListingCommentEvent,
  createEmptyListingCommentFeed,
  listingCommentRoots,
  listingCommentsByParent,
  orderedListingComments,
  parseListingCommentParentId,
  type ListingCommentEvent,
  type ListingCommentFeedState,
  type ListingCommentNode,
} from "@/lib/nostr/listing-comment-feed";
import { getNostrPool, NOSTR_RELAYS } from "@/lib/nostr/nostr-client";

export type { ListingCommentEvent, ListingCommentNode };
export { parseListingCommentParentId };

const INITIAL_LOAD_TIMEOUT_MS = 2000;
const PROGRESSIVE_FLUSH_MS = 120;
const INITIAL_EVENT_LIMIT = 100;
const LOOKBACK_SECONDS = 60 * 60 * 24 * 14;

export type UseListingCommentsResult = {
  pool: ReturnType<typeof getNostrPool>;
  events: Record<string, ListingCommentNode>;
  setEvents: (
    updater:
      | Record<string, ListingCommentNode>
      | ((prev: Record<string, ListingCommentNode>) => Record<string, ListingCommentNode>),
  ) => void;
  likesByTarget: Record<string, Set<string>>;
  setLikesByTarget: (
    updater:
      | Record<string, Set<string>>
      | ((prev: Record<string, Set<string>>) => Record<string, Set<string>>),
  ) => void;
  feedError: string | null;
  feedLoading: boolean;
  ordered: ListingCommentNode[];
  roots: ListingCommentNode[];
  byParent: Record<string, ListingCommentNode[]>;
};

const idleResult: UseListingCommentsResult = {
  pool: null as unknown as ReturnType<typeof getNostrPool>,
  events: {},
  setEvents: () => {},
  likesByTarget: {},
  setLikesByTarget: () => {},
  feedError: null,
  feedLoading: false,
  ordered: [],
  roots: [],
  byParent: {},
};

export function useListingComments(
  tokenId: string,
  options?: { enabled?: boolean },
): UseListingCommentsResult {
  const enabled = options?.enabled ?? true;
  const [feed, setFeed] = useState<ListingCommentFeedState>(createEmptyListingCommentFeed);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [feedLoading, setFeedLoading] = useState(enabled);

  const mountedRef = useRef(true);

  useEffect(() => {
    if (!enabled || !tokenId) {
      setFeedLoading(false);
      return;
    }

    mountedRef.current = true;
    setFeedLoading(true);
    setFeedError(null);
    setFeed(createEmptyListingCommentFeed());

    const pool = getNostrPool();
    const listingTag = `listing:${tokenId}`;
    const since = Math.floor(Date.now() / 1000) - LOOKBACK_SECONDS;
    const filter: Filter = {
      kinds: [1, 7],
      "#d": [listingTag],
      since,
      limit: INITIAL_EVENT_LIMIT,
    };

    let initialDone = false;
    let initialBuffer = createEmptyListingCommentFeed();
    let progressiveTimer: ReturnType<typeof setTimeout> | null = null;

    const publishInitialBuffer = () => {
      if (!mountedRef.current || initialDone) return;
      setFeed(initialBuffer);
    };

    const scheduleProgressiveFlush = () => {
      if (initialDone || progressiveTimer != null) return;
      progressiveTimer = setTimeout(() => {
        progressiveTimer = null;
        if (!mountedRef.current || initialDone) return;
        setFeed(initialBuffer);
        // First paint arrived — stop blocking UI on full EOSE.
        setFeedLoading(false);
      }, PROGRESSIVE_FLUSH_MS);
    };

    const liveBuffer = createDebouncedNostrEventBuffer<ListingCommentEvent>((batch) => {
      if (!mountedRef.current) return;
      setFeed((prev) =>
        batch.reduce((state, ev) => applyListingCommentEvent(state, ev), prev),
      );
    });

    const finishInitialLoad = () => {
      if (!mountedRef.current || initialDone) return;
      initialDone = true;
      if (progressiveTimer != null) {
        clearTimeout(progressiveTimer);
        progressiveTimer = null;
      }
      setFeed(initialBuffer);
      setFeedLoading(false);
    };

    const sub = pool.subscribeMany([...NOSTR_RELAYS], filter, {
      onevent: (ev: ListingCommentEvent) => {
        if (!mountedRef.current) return;
        if (!initialDone) {
          initialBuffer = applyListingCommentEvent(initialBuffer, ev);
          scheduleProgressiveFlush();
          return;
        }
        liveBuffer.push(ev);
      },
      oneose: finishInitialLoad,
      onclose: (reasons: string[]) => {
        finishInitialLoad();
        if (reasons.length > 0 && mountedRef.current) {
          setFeedError("Could not load comments. Please refresh the page.");
        }
      },
    });

    const timeout = window.setTimeout(finishInitialLoad, INITIAL_LOAD_TIMEOUT_MS);

    return () => {
      mountedRef.current = false;
      window.clearTimeout(timeout);
      if (progressiveTimer != null) clearTimeout(progressiveTimer);
      liveBuffer.clear();
      try {
        sub.close();
      } catch {
        // ignore
      }
    };
  }, [tokenId, enabled]);

  const { events, likesByTarget } = feed;

  const setEvents = useCallback(
    (
      updater:
        | Record<string, ListingCommentNode>
        | ((prev: Record<string, ListingCommentNode>) => Record<string, ListingCommentNode>),
    ) => {
      setFeed((prev) => {
        const nextEvents = typeof updater === "function" ? updater(prev.events) : updater;
        return { ...prev, events: nextEvents };
      });
    },
    [],
  );

  const setLikesByTarget = useCallback(
    (
      updater:
        | Record<string, Set<string>>
        | ((prev: Record<string, Set<string>>) => Record<string, Set<string>>),
    ) => {
      setFeed((prev) => {
        const nextLikes = typeof updater === "function" ? updater(prev.likesByTarget) : updater;
        return { ...prev, likesByTarget: nextLikes };
      });
    },
    [],
  );

  const ordered = useMemo(() => orderedListingComments(events), [events]);
  const roots = useMemo(() => listingCommentRoots(ordered), [ordered]);
  const byParent = useMemo(() => listingCommentsByParent(ordered), [ordered]);

  const pool = useMemo(() => getNostrPool(), []);

  if (!enabled) {
    return idleResult;
  }

  return {
    pool,
    events,
    setEvents,
    likesByTarget,
    setLikesByTarget,
    feedError,
    feedLoading,
    ordered,
    roots,
    byParent,
  };
}
