import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  sortConversationSummaries,
  sumUnreadCounts,
  type ConversationSummary,
} from "../lib/messaging/conversations.ts";

function summary(
  id: string,
  lastMessageAt: Date | null,
  unreadCount = 0,
): ConversationSummary {
  return {
    id,
    peerAddress: "0x0000000000000000000000000000000000000001",
    lastMessage: "hello",
    lastMessageAt,
    unreadCount,
  };
}

describe("sortConversationSummaries", () => {
  it("orders by lastMessageAt descending", () => {
    const sorted = sortConversationSummaries([
      summary("a", new Date("2026-01-01T00:00:00Z")),
      summary("b", new Date("2026-01-03T00:00:00Z")),
      summary("c", new Date("2026-01-02T00:00:00Z")),
    ]);

    assert.deepEqual(sorted.map((row) => row.id), ["b", "c", "a"]);
  });

  it("treats missing timestamps as oldest", () => {
    const sorted = sortConversationSummaries([
      summary("none", null),
      summary("recent", new Date("2026-01-02T00:00:00Z")),
    ]);

    assert.deepEqual(sorted.map((row) => row.id), ["recent", "none"]);
  });
});

describe("sumUnreadCounts", () => {
  it("sums unread across conversations", () => {
    const total = sumUnreadCounts([
      summary("a", null, 2),
      summary("b", null, 0),
      summary("c", null, 5),
    ]);

    assert.equal(total, 7);
  });
});
