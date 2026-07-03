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

const INITIAL_LOAD_TIMEOUT_MS = 4500;

export function useListingComments(tokenId: string) {
  const [feed, setFeed] = useState<ListingCommentFeedState>(createEmptyListingCommentFeed);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [feedLoading, setFeedLoading] = useState(true);

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    setFeedLoading(true);
    setFeedError(null);
    setFeed(createEmptyListingCommentFeed());

    const pool = getNostrPool();
    const listingTag = `listing:${tokenId}`;
    const since = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 30;
    const filter: Filter = { kinds: [1, 7], "#d": [listingTag], since, limit: 500 };

    let initialDone = false;
    let initialBuffer = createEmptyListingCommentFeed();

    const liveBuffer = createDebouncedNostrEventBuffer<ListingCommentEvent>((batch) => {
      if (!mountedRef.current) return;
      setFeed((prev) =>
        batch.reduce((state, ev) => applyListingCommentEvent(state, ev), prev),
      );
    });

    const finishInitialLoad = () => {
      if (!mountedRef.current || initialDone) return;
      initialDone = true;
      setFeed(initialBuffer);
      setFeedLoading(false);
    };

    const sub = pool.subscribeMany(
      [...NOSTR_RELAYS],
      filter,
      {
        onevent: (ev: ListingCommentEvent) => {
          if (!mountedRef.current) return;
          if (!initialDone) {
            initialBuffer = applyListingCommentEvent(initialBuffer, ev);
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
      },
    );

    const timeout = window.setTimeout(finishInitialLoad, INITIAL_LOAD_TIMEOUT_MS);

    return () => {
      mountedRef.current = false;
      window.clearTimeout(timeout);
      liveBuffer.clear();
      try {
        sub.close();
      } catch {
        // ignore
      }
    };
  }, [tokenId]);

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
