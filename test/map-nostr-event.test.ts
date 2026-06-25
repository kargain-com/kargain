import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Event } from "nostr-tools";

import { mapNostrEventToNotification } from "../lib/notifications/map-nostr-event.ts";

const MY_PUBKEY = "aa".repeat(32);
const OTHER_PUBKEY = "bb".repeat(32);

function baseEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: "event-id",
    pubkey: OTHER_PUBKEY,
    created_at: 1_700_000_100,
    kind: 1,
    tags: [["d", "listing:42"]],
    content: "hello",
    sig: "sig",
    ...overrides,
  };
}

describe("mapNostrEventToNotification", () => {
  it("ignores self-authored replies that mention own pubkey", () => {
    const event = baseEvent({
      pubkey: MY_PUBKEY,
      tags: [
        ["d", "listing:42"],
        ["e", "parent-id", "", "reply"],
        ["p", MY_PUBKEY],
      ],
    });
    assert.equal(mapNostrEventToNotification(event, MY_PUBKEY, 0), null);
  });

  it("ignores self-authored top-level comments on owned listing", () => {
    const event = baseEvent({
      pubkey: MY_PUBKEY,
      tags: [["d", "listing:42"]],
    });
    assert.equal(mapNostrEventToNotification(event, MY_PUBKEY, 0), null);
  });

  it("keeps replies from others that mention my pubkey", () => {
    const event = baseEvent({
      tags: [
        ["d", "listing:42"],
        ["e", "parent-id", "", "reply"],
        ["p", MY_PUBKEY],
      ],
    });
    const item = mapNostrEventToNotification(event, MY_PUBKEY, 0);
    assert.equal(item?.type, "nostr.reply_to_comment");
  });

  it("keeps comments from others on my listing", () => {
    const event = baseEvent({ tags: [["d", "listing:42"]] });
    const item = mapNostrEventToNotification(event, MY_PUBKEY, 0);
    assert.equal(item?.type, "nostr.comment_on_passport");
  });
});
