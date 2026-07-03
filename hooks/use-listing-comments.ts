"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { type Filter } from "nostr-tools";
import { SimplePool } from "nostr-tools/pool";

import { NOSTR_RELAYS } from "@/lib/nostr/nostr-client";

export type ListingCommentEvent = {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  content: string;
  tags: string[][];
};

export type ListingCommentNode = {
  event: ListingCommentEvent;
  parentId: string | null;
  optimistic?: boolean;
};

export function parseListingCommentParentId(ev: ListingCommentEvent): string | null {
  const reply = ev.tags.find((t) => t[0] === "e" && t[3] === "reply");
  if (reply?.[1]) return reply[1];
  const firstE = ev.tags.find((t) => t[0] === "e");
  return firstE?.[1] ?? null;
}

export function useListingComments(tokenId: string) {
  const [events, setEvents] = useState<Record<string, ListingCommentNode>>({});
  const [likesByTarget, setLikesByTarget] = useState<Record<string, Set<string>>>({});
  const [feedError, setFeedError] = useState<string | null>(null);
  const [feedLoading, setFeedLoading] = useState(true);

  const pool = useMemo(() => new SimplePool(), []);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    setFeedLoading(true);
    setFeedError(null);

    const listingTag = `listing:${tokenId}`;
    const since = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 30;
    const filter: Filter = { kinds: [1, 7], "#d": [listingTag], since, limit: 500 };
    const sub = pool.subscribeMany(
      [...NOSTR_RELAYS],
      filter,
      {
        onevent: (ev: ListingCommentEvent) => {
          if (ev.kind === 1) {
            const parentId = parseListingCommentParentId(ev);
            setEvents((prev) => ({ ...prev, [ev.id]: { event: ev, parentId } }));
            return;
          }
          if (ev.kind === 7) {
            const target = ev.tags.find((t) => t[0] === "e")?.[1];
            if (!target) return;
            setLikesByTarget((prev) => {
              const next = { ...prev };
              const current = new Set(next[target] ?? []);
              current.add(ev.pubkey);
              next[target] = current;
              return next;
            });
          }
        },
        oneose: () => setFeedLoading(false),
        onclose: (reasons: string[]) => {
          setFeedLoading(false);
          if (reasons.length > 0) {
            setFeedError("Could not load comments. Please refresh the page.");
          }
        },
      },
    );
    const timeout = window.setTimeout(() => {
      if (mountedRef.current) setFeedLoading(false);
    }, 4500);
    return () => {
      mountedRef.current = false;
      window.clearTimeout(timeout);
      try {
        sub.close();
      } catch {
        // ignore
      }
    };
  }, [pool, tokenId]);

  const ordered = useMemo(
    () => Object.values(events).sort((a, b) => a.event.created_at - b.event.created_at),
    [events],
  );
  const roots = useMemo(() => ordered.filter((c) => !c.parentId), [ordered]);
  const byParent = useMemo(() => {
    const map: Record<string, ListingCommentNode[]> = {};
    for (const c of ordered) {
      if (!c.parentId) continue;
      map[c.parentId] ??= [];
      map[c.parentId].push(c);
    }
    return map;
  }, [ordered]);

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
