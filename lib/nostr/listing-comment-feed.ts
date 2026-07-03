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

export type ListingCommentFeedState = {
  events: Record<string, ListingCommentNode>;
  likesByTarget: Record<string, Set<string>>;
};

export function createEmptyListingCommentFeed(): ListingCommentFeedState {
  return { events: {}, likesByTarget: {} };
}

export function parseListingCommentParentId(ev: ListingCommentEvent): string | null {
  const reply = ev.tags.find((t) => t[0] === "e" && t[3] === "reply");
  if (reply?.[1]) return reply[1];
  const firstE = ev.tags.find((t) => t[0] === "e");
  return firstE?.[1] ?? null;
}

export function applyListingCommentEvent(
  state: ListingCommentFeedState,
  ev: ListingCommentEvent,
): ListingCommentFeedState {
  if (ev.kind === 1) {
    const parentId = parseListingCommentParentId(ev);
    return {
      ...state,
      events: {
        ...state.events,
        [ev.id]: { event: ev, parentId },
      },
    };
  }

  if (ev.kind === 7) {
    const target = ev.tags.find((t) => t[0] === "e")?.[1];
    if (!target) return state;
    const nextLikes = { ...state.likesByTarget };
    const current = new Set(nextLikes[target] ?? []);
    current.add(ev.pubkey);
    nextLikes[target] = current;
    return { ...state, likesByTarget: nextLikes };
  }

  return state;
}

export function applyListingCommentEvents(
  state: ListingCommentFeedState,
  events: ListingCommentEvent[],
): ListingCommentFeedState {
  return events.reduce(applyListingCommentEvent, state);
}

export function orderedListingComments(
  events: Record<string, ListingCommentNode>,
): ListingCommentNode[] {
  return Object.values(events).sort((a, b) => a.event.created_at - b.event.created_at);
}

export function listingCommentRoots(ordered: ListingCommentNode[]): ListingCommentNode[] {
  return ordered.filter((c) => !c.parentId);
}

export function listingCommentsByParent(
  ordered: ListingCommentNode[],
): Record<string, ListingCommentNode[]> {
  const map: Record<string, ListingCommentNode[]> = {};
  for (const c of ordered) {
    if (!c.parentId) continue;
    map[c.parentId] ??= [];
    map[c.parentId].push(c);
  }
  return map;
}
