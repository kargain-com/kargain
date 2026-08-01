import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Event } from "nostr-tools";

import {
  applyLwwAdd,
  applyLwwRemove,
  buildLwwLegacyTags,
  FAVORITES_LIST_ID,
  FAVORITES_POLICY,
  LWW_RELAY_READ_DEADLINE_MS,
  LWW_TOMBSTONE_PRUNE_SECONDS,
  fetchAppEvents,
  lwwActiveTokenIds,
  mergeLwwElementSetEvents,
  parseLwwElementSetEvent,
  pruneLwwTombstones,
  publishLwwElementSet,
  serializeLwwContent,
  type AppEventEnsureRelayParams,
  type AppEventRelay,
} from "../lib/nostr/app-event-store.ts";
import { KARGAIN_RELAY, NOSTR_RELAYS } from "../lib/nostr/relays.ts";

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
  it("returns false when all target relays fail", async () => {
    const pool = {
      publish(urls: string[]) {
        return urls.map(() => Promise.reject(new Error("fail")));
      },
      async ensureRelay() {
        throw new Error("unused");
      },
    };

    const ok = await publishLwwElementSet(
      pool,
      `0x${"11".repeat(32)}`,
      FAVORITES_POLICY,
      applyLwwAdd({ items: {}, removed: {} }, "1", 100),
      [...NOSTR_RELAYS],
    );

    assert.equal(ok, false);
    assert.equal(NOSTR_RELAYS.length > 0, true);
  });

  it("returns false when answeredRelays is empty", async () => {
    let publishCount = 0;
    const pool = {
      publish(urls: string[]) {
        publishCount += 1;
        return urls.map(() => Promise.resolve("ok"));
      },
      async ensureRelay() {
        throw new Error("unused");
      },
    };

    const ok = await publishLwwElementSet(
      pool,
      `0x${"11".repeat(32)}`,
      FAVORITES_POLICY,
      applyLwwAdd({ items: {}, removed: {} }, "1", 100),
      [],
    );

    assert.equal(ok, false);
    assert.equal(publishCount, 0);
  });

  it("publishes only to the answered relay list", async () => {
    const published: string[][] = [];
    const targets = [NOSTR_RELAYS[0]!, NOSTR_RELAYS[1]!];
    const pool = {
      publish(urls: string[]) {
        published.push([...urls]);
        return urls.map(() => Promise.resolve("ok"));
      },
      async ensureRelay() {
        throw new Error("unused");
      },
    };

    const ok = await publishLwwElementSet(
      pool,
      `0x${"11".repeat(32)}`,
      FAVORITES_POLICY,
      applyLwwAdd({ items: {}, removed: {} }, "1", 100),
      targets,
    );

    assert.equal(ok, true);
    assert.deepEqual(published, [targets]);
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

describe("fetchAppEvents coverage", () => {
  it("returns unanswered when every relay closes before EOSE", async () => {
    const pool = {
      async ensureRelay(_url: string): Promise<AppEventRelay> {
        return {
          subscribe(_filters, params) {
            queueMicrotask(() => params.onclose?.("closed-before-eose"));
            return { close: () => undefined };
          },
        };
      },
    };

    const result = await fetchAppEvents(pool, PUBKEY, FAVORITES_POLICY);
    assert.deepEqual(result, { status: "unanswered", cause: "no-relay-answered" });
  });

  it("includes only relays that reach real EOSE", async () => {
    const pool = {
      async ensureRelay(url: string): Promise<AppEventRelay> {
        return {
          subscribe(_filters, params) {
            queueMicrotask(() => {
              if (url === KARGAIN_RELAY) {
                params.onclose?.("limit");
                return;
              }
              params.onevent?.(
                makeEvent({
                  id: "ab".repeat(32),
                  created_at: 1,
                  content: JSON.stringify({ v: 1, items: { "1": { a: 1 } }, removed: {} }),
                }),
              );
              params.oneose?.();
            });
            return { close: () => undefined };
          },
        };
      },
    };

    const result = await fetchAppEvents(pool, PUBKEY, FAVORITES_POLICY);
    assert.equal(result.status, "answered");
    if (result.status !== "answered") return;
    assert.ok(!result.answeredRelays.includes(KARGAIN_RELAY));
    assert.equal(result.answeredRelays.length, NOSTR_RELAYS.length - 1);
    assert.equal(result.events.length, 1);
  });

  it("never-settling ensureRelay stays within the shared deadline and is unanswered", async () => {
    const seenTimeouts: Array<number | undefined> = [];
    const pool = {
      async ensureRelay(
        url: string,
        params?: AppEventEnsureRelayParams,
      ): Promise<AppEventRelay> {
        seenTimeouts.push(params?.connectionTimeout);
        if (url === KARGAIN_RELAY) {
          // Hang forever — connectionTimeout must be armed by the caller (or raced).
          return new Promise(() => undefined);
        }
        return {
          subscribe(_filters, params) {
            queueMicrotask(() => {
              params.onevent?.(
                makeEvent({
                  id: "ef".repeat(32),
                  created_at: 2,
                  content: JSON.stringify({
                    v: 1,
                    items: { "9": { a: 2 } },
                    removed: {},
                  }),
                }),
              );
              params.oneose?.();
            });
            return { close: () => undefined };
          },
        };
      },
    };

    const started = Date.now();
    const result = await fetchAppEvents(pool, PUBKEY, FAVORITES_POLICY);
    const elapsed = Date.now() - started;

    assert.ok(
      elapsed <= LWW_RELAY_READ_DEADLINE_MS + 750,
      `fetchAppEvents took ${elapsed}ms; deadline is ${LWW_RELAY_READ_DEADLINE_MS}ms`,
    );
    assert.ok(
      seenTimeouts.every((t) => typeof t === "number" && t > 0 && t <= LWW_RELAY_READ_DEADLINE_MS),
      "every ensureRelay must receive a positive connectionTimeout within the budget",
    );
    assert.equal(result.status, "answered");
    if (result.status !== "answered") return;
    assert.ok(!result.answeredRelays.includes(KARGAIN_RELAY));
    assert.equal(result.answeredRelays.length, NOSTR_RELAYS.length - 1);
    assert.equal(result.events.length, 1);
  });
});
