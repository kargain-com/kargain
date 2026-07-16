import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CONVERSATIONS_SYNC_DEBOUNCE_MS,
  shouldSyncConversations,
} from "../lib/messaging/conversations-sync.ts";

describe("shouldSyncConversations", () => {
  it("allows first sync when lastSyncAt is null", () => {
    assert.equal(shouldSyncConversations(null, 10_000), true);
  });

  it("blocks sync inside debounce window", () => {
    const now = 10_000;
    const last = now - CONVERSATIONS_SYNC_DEBOUNCE_MS + 1;
    assert.equal(shouldSyncConversations(last, now), false);
  });

  it("allows sync after debounce window", () => {
    const now = 10_000;
    const last = now - CONVERSATIONS_SYNC_DEBOUNCE_MS;
    assert.equal(shouldSyncConversations(last, now), true);
  });

  it("respects custom min interval", () => {
    assert.equal(shouldSyncConversations(0, 4_999, 5_000), false);
    assert.equal(shouldSyncConversations(0, 5_000, 5_000), true);
  });
});
