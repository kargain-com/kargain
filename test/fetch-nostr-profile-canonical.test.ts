import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Event } from "nostr-tools";

import { pickLatestKind0Event } from "../lib/nostr/pick-latest-kind0.ts";

function kind0Event(createdAt: number, content: string): Event {
  return {
    id: `id-${createdAt}`,
    pubkey: "abc",
    created_at: createdAt,
    kind: 0,
    tags: [],
    content,
    sig: "sig",
  };
}

describe("pickLatestKind0Event", () => {
  it("returns null for empty list", () => {
    assert.equal(pickLatestKind0Event([]), null);
  });

  it("picks newest created_at", () => {
    const older = kind0Event(100, JSON.stringify({ messagesEnabled: false }));
    const newer = kind0Event(200, JSON.stringify({ messagesEnabled: true }));
    const picked = pickLatestKind0Event([older, newer]);
    assert.equal(picked?.created_at, 200);
    assert.match(picked?.content ?? "", /true/);
  });
});
