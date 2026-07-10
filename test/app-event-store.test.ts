import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Event } from "nostr-tools";

import {
  applyLwwAdd,
  applyLwwRemove,
  buildLwwLegacyTags,
  FAVORITES_LIST_ID,
  FAVORITES_POLICY,
  LWW_TOMBSTONE_PRUNE_SECONDS,
  lwwActiveTokenIds,
  mergeLwwElementSetEvents,
  parseLwwElementSetEvent,
  pruneLwwTombstones,
  publishLwwElementSet,
  serializeLwwContent,
} from "../lib/nostr/app-event-store.ts";
import { NOSTR_RELAYS } from "../lib/nostr/relays.ts";

const PUBKEY = "aa".repeat(32);

function makeEvent(overrides: Partial<Event> & Pick<Event, "created_at">): Event {
  return {
    id: "ee".repeat(32),
    pubkey: PUBKEY,
    kind: 30000,
    tags: [["d", FAVORITES_LIST_ID]],
    content: "",
    sig: "cc".repeat(64),
    ...overrides,
  };
}

function v1Content(items: Record<string, { a: number }>, removed: Record<string, { r: number }> = {}) {
  return JSON.stringify({ v: 1, items, removed });
}

describe("parseLwwElementSetEvent", () => {
  it("legacy tag-only event parses as adds at created_at", () => {
    const createdAt = 2_000_000_000;
    const event = makeEvent({
      created_at: createdAt,
      tags: [
        ["d", FAVORITES_LIST_ID],
        ["i", "kargain:passport:42"],
        ["i", "kargain:passport:99"],
      ],
    });
    const parsed = parseLwwElementSetEvent(event);
    assert.deepEqual(parsed.items, {
      "42": { a: createdAt },
      "99": { a: createdAt },
    });
    assert.deepEqual(parsed.removed, {});
  });
});

describe("mergeLwwElementSetEvents", () => {
  const now = 2_000_000_000;

  it("add then remove — remove wins", () => {
    const addEvent = makeEvent({
      created_at: now - 300,
      content: v1Content({ "1": { a: now - 300 } }),
    });
    const removeEvent = makeEvent({
      created_at: now - 100,
      content: v1Content({}, { "1": { r: now - 100 } }),
    });
    const merged = mergeLwwElementSetEvents([addEvent, removeEvent]);
    assert.deepEqual(lwwActiveTokenIds(merged), []);
  });

  it("remove then stale add merge — tombstone wins", () => {
    const removeEvent = makeEvent({
      created_at: now - 100,
      content: v1Content({}, { "7": { r: now - 100 } }),
    });
    const staleAddEvent = makeEvent({
      created_at: now - 400,
      content: v1Content({ "7": { a: now - 400 } }),
    });
    const merged = mergeLwwElementSetEvents([removeEvent, staleAddEvent]);
    assert.deepEqual(lwwActiveTokenIds(merged), []);
  });

  it("add/remove tie resolves to add", () => {
    const ts = now - 200;
    const eventA = makeEvent({
      created_at: ts,
      content: v1Content({ "5": { a: ts } }),
    });
    const eventB = makeEvent({
      created_at: ts + 1,
      content: v1Content({}, { "5": { r: ts } }),
    });
    const merged = mergeLwwElementSetEvents([eventA, eventB]);
    assert.deepEqual(lwwActiveTokenIds(merged), ["5"]);
  });

  it("legacy + v1 event merge preserves union", () => {
    const legacy = makeEvent({
      created_at: now - 500,
      tags: [
        ["d", FAVORITES_LIST_ID],
        ["i", "kargain:passport:legacy-a"],
      ],
    });
    const v1 = makeEvent({
      created_at: now - 400,
      content: v1Content({ "v1-b": { a: now - 400 } }),
    });
    const merged = mergeLwwElementSetEvents([legacy, v1]);
    assert.deepEqual(lwwActiveTokenIds(merged), ["legacy-a", "v1-b"]);
  });
});

describe("pruneLwwTombstones", () => {
  it("tombstone pruning drops removed older than 90 days", () => {
    const now = 2_000_000_000;
    const state = {
      items: {},
      removed: {
        old: { r: now - LWW_TOMBSTONE_PRUNE_SECONDS - 1 },
        fresh: { r: now - 1 },
      },
    };
    const pruned = pruneLwwTombstones(state, now);
    assert.deepEqual(pruned.removed, { fresh: { r: now - 1 } });
  });
});

describe("serializeLwwContent / buildLwwLegacyTags", () => {
  it("serialize mirrors legacy i tags for active set", () => {
    const state = applyLwwAdd({ items: {}, removed: {} }, "token-1", 100);
    const next = applyLwwAdd(state, "token-2", 200);
    const content = serializeLwwContent(next);
    assert.equal(JSON.parse(content).v, 1);
    const tags = buildLwwLegacyTags(lwwActiveTokenIds(next), FAVORITES_LIST_ID);
    assert.deepEqual(tags, [
      ["d", FAVORITES_LIST_ID],
      ["i", "kargain:passport:token-1"],
      ["i", "kargain:passport:token-2"],
    ]);
  });
});

describe("publishLwwElementSet", () => {
  it("returns false when all relays fail", async () => {
    const pool = {
      publish(urls: string[]) {
        return urls.map(() => Promise.reject(new Error("fail")));
      },
      querySync: async () => [],
    };

    const ok = await publishLwwElementSet(
      pool,
      `0x${"11".repeat(32)}`,
      FAVORITES_POLICY,
      applyLwwAdd({ items: {}, removed: {} }, "1", 100),
    );

    assert.equal(ok, false);
    assert.equal(NOSTR_RELAYS.length > 0, true);
  });
});

describe("applyLwwAdd / applyLwwRemove", () => {
  it("remove clears item entry and add clears removed entry", () => {
    let state = applyLwwAdd({ items: {}, removed: {} }, "x", 10);
    state = applyLwwRemove(state, "x", 20);
    assert.equal(state.items.x, undefined);
    assert.equal(state.removed.x?.r, 20);

    state = applyLwwAdd(state, "x", 30);
    assert.equal(state.items.x?.a, 30);
    assert.equal(state.removed.x, undefined);
  });
});
