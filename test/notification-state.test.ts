import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mergeNotificationStates } from "../lib/nostr/notification-state.ts";
import { marketplaceCommentHref } from "../lib/notifications/notification-href.ts";

describe("notification state", () => {
  it("mergeNotificationStates takes max per channel", () => {
    const merged = mergeNotificationStates(
      { lastSeenAt: { ponder: 100, nostr: 50, watchlist: 0 } },
      { lastSeenAt: { ponder: 200, nostr: 30, watchlist: 10 } },
    );
    assert.deepEqual(merged.lastSeenAt, { ponder: 200, nostr: 50, watchlist: 10 });
  });

  it("mergeNotificationStates combines local and remote watermarks", () => {
    const local = { lastSeenAt: { ponder: 500, nostr: 0, watchlist: 100 } };
    const remote = { lastSeenAt: { ponder: 300, nostr: 400, watchlist: 50 } };
    const merged = mergeNotificationStates(local, remote);
    assert.deepEqual(merged.lastSeenAt, { ponder: 500, nostr: 400, watchlist: 100 });
  });

  it("ponder since-filter excludes items at or before lastSeenAt", () => {
    const since = 1_700_000_000;
    const items = [
      { type: "passport.verified", timestamp: "1699999999" },
      { type: "passport.verified", timestamp: "1700000001" },
      { type: "listing.sold", timestamp: "1700000000" },
    ];
    const filtered = items.filter((item) => BigInt(item.timestamp) > BigInt(since));
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.timestamp, "1700000001");
  });
});

describe("notification href", () => {
  it("marketplaceCommentHref without event id uses comments anchor", () => {
    assert.equal(marketplaceCommentHref("42"), "/marketplace/42#passport-comments");
  });

  it("marketplaceCommentHref with event id adds query and anchor", () => {
    assert.equal(
      marketplaceCommentHref("42", "abc123"),
      "/marketplace/42?e=abc123#passport-comments",
    );
  });
});
