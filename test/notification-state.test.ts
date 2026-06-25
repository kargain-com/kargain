import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mergeNotificationStates } from "../lib/nostr/notification-state.ts";

describe("notification state", () => {
  it("mergeNotificationStates takes max per channel", () => {
    const merged = mergeNotificationStates(
      { lastSeenAt: { ponder: 100, nostr: 50, watchlist: 0 } },
      { lastSeenAt: { ponder: 200, nostr: 30, watchlist: 10 } },
    );
    assert.deepEqual(merged.lastSeenAt, { ponder: 200, nostr: 50, watchlist: 10 });
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
