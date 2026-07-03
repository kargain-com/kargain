import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ListingCommentNode } from "../lib/nostr/listing-comment-feed.ts";
import { selectPassportTopComment } from "../lib/passport/passport-comment-summary.ts";

function commentNode(
  id: string,
  createdAt: number,
  evmAddress?: string,
): ListingCommentNode {
  return {
    event: {
      id,
      pubkey: `${id}-pubkey`,
      created_at: createdAt,
      kind: 1,
      content: `comment ${id}`,
      tags: evmAddress
        ? [
            ["d", "listing:1"],
            ["evm", evmAddress],
          ]
        : [["d", "listing:1"]],
    },
    parentId: null,
  };
}

describe("selectPassportTopComment", () => {
  it("prefers the root comment with the most replies", () => {
    const rootA = commentNode("root-a", 100, "0x00000000000000000000000000000000000000aa");
    const rootB = commentNode("root-b", 200, "0x00000000000000000000000000000000000000bb");

    const topComment = selectPassportTopComment([rootA, rootB], {
      "root-a": [
        { ...commentNode("reply-a1", 110), parentId: "root-a" },
        { ...commentNode("reply-a2", 120), parentId: "root-a" },
      ],
      "root-b": [{ ...commentNode("reply-b1", 210), parentId: "root-b" }],
    });

    assert.equal(topComment?.id, "root-a");
    assert.equal(topComment?.replyCount, 2);
    assert.equal(topComment?.authorAddress, "0x00000000000000000000000000000000000000AA");
  });

  it("falls back to the most recent root when none have replies", () => {
    const rootA = commentNode("root-a", 100);
    const rootB = commentNode("root-b", 200);

    const topComment = selectPassportTopComment([rootA, rootB], {});

    assert.equal(topComment?.id, "root-b");
    assert.equal(topComment?.replyCount, 0);
    assert.equal(topComment?.authorAddress, null);
  });
});
