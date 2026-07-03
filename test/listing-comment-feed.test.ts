import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyListingCommentEvent,
  applyListingCommentEvents,
  createEmptyListingCommentFeed,
  listingCommentRoots,
  parseListingCommentParentId,
  type ListingCommentEvent,
} from "../lib/nostr/listing-comment-feed.ts";

function commentEvent(
  id: string,
  overrides: Partial<ListingCommentEvent> = {},
): ListingCommentEvent {
  return {
    id,
    pubkey: "aa".repeat(32),
    created_at: 1_700_000_000,
    kind: 1,
    content: `comment ${id}`,
    tags: [["d", "listing:1"]],
    ...overrides,
  };
}

describe("listing-comment-feed", () => {
  it("parseListingCommentParentId prefers reply tag marker", () => {
    const ev = commentEvent("c1", {
      tags: [
        ["d", "listing:1"],
        ["e", "parent", "", "reply"],
      ],
    });
    assert.equal(parseListingCommentParentId(ev), "parent");
  });

  it("applyListingCommentEvents batches comments and likes", () => {
    const root = commentEvent("root");
    const reply = commentEvent("reply", {
      created_at: root.created_at + 1,
      tags: [
        ["d", "listing:1"],
        ["e", "root", "", "reply"],
      ],
    });
    const like: ListingCommentEvent = {
      id: "like",
      pubkey: "bb".repeat(32),
      created_at: root.created_at + 2,
      kind: 7,
      content: "+",
      tags: [["e", "root"]],
    };

    const state = applyListingCommentEvents(createEmptyListingCommentFeed(), [root, reply, like]);

    assert.deepEqual(Object.keys(state.events).sort(), ["reply", "root"]);
    assert.equal(state.likesByTarget.root?.size, 1);
    assert.equal(
      listingCommentRoots(
        Object.values(state.events).sort((a, b) => a.event.created_at - b.event.created_at),
      ).length,
      1,
    );
  });

  it("applyListingCommentEvent merges likes onto existing targets", () => {
    let state = createEmptyListingCommentFeed();
    state = applyListingCommentEvent(state, commentEvent("root"));
    state = applyListingCommentEvent(state, {
      id: "like",
      pubkey: "cc".repeat(32),
      created_at: 2,
      kind: 7,
      content: "+",
      tags: [["e", "root"]],
    });
    assert.equal(state.likesByTarget.root?.size, 1);
  });
});
