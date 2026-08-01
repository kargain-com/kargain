import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Event } from "nostr-tools";

import {
  setAppEventStorePoolForTest,
  type AppEventQueryPool,
  type AppEventRelay,
} from "../lib/nostr/app-event-store.ts";
import { nostrPubkeyFromPrivateKey } from "../lib/nostr/nostr-client.ts";
import {
  loadNotificationState,
  mergeNotificationStates,
  saveNotificationState,
} from "../lib/nostr/notification-state.ts";
import type { NostrPublishPool } from "../lib/nostr/publish-event.ts";
import { KARGAIN_RELAY, NOSTR_RELAYS } from "../lib/nostr/relays.ts";

const PRIVATE_KEY = `0x${"11".repeat(32)}` as const;
const PUBKEY = nostrPubkeyFromPrivateKey(PRIVATE_KEY);

type RelayScript =
  | { mode: "eose"; events?: Event[] }
  | { mode: "close-before-eose" }
  | { mode: "ensure-reject" };

type TestPool = AppEventQueryPool &
  NostrPublishPool & {
    publishedUrls: string[][];
    publishCount: number;
    lastPublished: Event | null;
  };

function makeEvent(overrides: Partial<Event> & Pick<Event, "created_at" | "content">): Event {
  return {
    id: "ee".repeat(32),
    pubkey: PUBKEY,
    kind: 30078,
    tags: [["d", "kargain-notifications-v1"]],
    sig: "cc".repeat(64),
    ...overrides,
  };
}

function makeTestPool(options: {
  scripts?: Partial<Record<string, RelayScript>>;
  defaultScript?: RelayScript;
  publishOk?: boolean;
}): TestPool {
  const publishedUrls: string[][] = [];
  let publishCount = 0;
  let lastPublished: Event | null = null;
  const defaultScript: RelayScript = options.defaultScript ?? { mode: "eose", events: [] };
  const scripts = options.scripts ?? {};
  const publishOk = options.publishOk ?? true;

  const pool: TestPool = {
    publishedUrls,
    get publishCount() {
      return publishCount;
    },
    get lastPublished() {
      return lastPublished;
    },
    async ensureRelay(url) {
      const script = scripts[url] ?? defaultScript;
      if (script.mode === "ensure-reject") {
        throw new Error(`ensureRelay failed: ${url}`);
      }

      const relay: AppEventRelay = {
        subscribe(_filters, params) {
          let closed = false;
          const close = () => {
            if (closed) return;
            closed = true;
            params.onclose?.("closed");
          };

          queueMicrotask(() => {
            if (closed) return;
            if (script.mode === "close-before-eose") {
              close();
              return;
            }
            for (const event of script.events ?? []) {
              params.onevent?.(event);
            }
            params.oneose?.();
          });

          return { close };
        },
      };
      return relay;
    },
    publish(urls, event) {
      publishCount += 1;
      publishedUrls.push([...urls]);
      lastPublished = event;
      if (!publishOk) {
        return urls.map(() => Promise.reject(new Error("publish fail")));
      }
      return urls.map(() => Promise.resolve("ok"));
    },
  };

  return pool;
}

afterEach(() => {
  setAppEventStorePoolForTest(null);
});

describe("loadNotificationState coverage", () => {
  it("returns unanswered when no relay reaches EOSE", async () => {
    const pool = makeTestPool({ defaultScript: { mode: "close-before-eose" } });
    setAppEventStorePoolForTest(pool);

    const result = await loadNotificationState(PUBKEY, { pool });
    assert.deepEqual(result, { status: "unanswered", cause: "no-relay-answered" });
  });

  it("returns answered-empty DEFAULT when relays EOSE with no events", async () => {
    const pool = makeTestPool({ defaultScript: { mode: "eose", events: [] } });
    setAppEventStorePoolForTest(pool);

    const result = await loadNotificationState(PUBKEY, { pool });
    assert.equal(result.status, "answered");
    if (result.status !== "answered") return;
    assert.deepEqual(result.state.lastSeenAt, { ponder: 0, nostr: 0, watchlist: 0 });
    assert.equal(result.answeredRelays.length, NOSTR_RELAYS.length);
  });

  it("parses newest answered event and excludes unanswered relays", async () => {
    const pool = makeTestPool({
      defaultScript: {
        mode: "eose",
        events: [
          makeEvent({
            id: "11".repeat(32),
            created_at: 10,
            content: JSON.stringify({
              lastSeenAt: { ponder: 100, nostr: 0, watchlist: 0 },
            }),
          }),
          makeEvent({
            id: "22".repeat(32),
            created_at: 20,
            content: JSON.stringify({
              lastSeenAt: { ponder: 200, nostr: 50, watchlist: 10 },
            }),
          }),
        ],
      },
      scripts: { [KARGAIN_RELAY]: { mode: "close-before-eose" } },
    });
    setAppEventStorePoolForTest(pool);

    const result = await loadNotificationState(PUBKEY, { pool });
    assert.equal(result.status, "answered");
    if (result.status !== "answered") return;
    assert.deepEqual(result.state.lastSeenAt, { ponder: 200, nostr: 50, watchlist: 10 });
    assert.ok(!result.answeredRelays.includes(KARGAIN_RELAY));
    assert.equal(result.answeredRelays.length, NOSTR_RELAYS.length - 1);
  });
});

describe("saveNotificationState coverage", () => {
  it("does not publish when coverage is unanswered", async () => {
    const pool = makeTestPool({ defaultScript: { mode: "close-before-eose" } });
    setAppEventStorePoolForTest(pool);

    await saveNotificationState(
      { lastSeenAt: { ponder: 50, nostr: 0, watchlist: 0 } },
      PRIVATE_KEY,
    );

    assert.equal(pool.publishCount, 0);
  });

  it("publishes only to answered relays (subset when one closes before EOSE)", async () => {
    const pool = makeTestPool({
      defaultScript: { mode: "eose", events: [] },
      scripts: { [KARGAIN_RELAY]: { mode: "close-before-eose" } },
    });
    setAppEventStorePoolForTest(pool);

    await saveNotificationState(
      { lastSeenAt: { ponder: 50, nostr: 0, watchlist: 0 } },
      PRIVATE_KEY,
    );

    assert.equal(pool.publishCount, 1);
    const urls = pool.publishedUrls[0]!;
    assert.ok(!urls.includes(KARGAIN_RELAY));
    assert.equal(urls.length, NOSTR_RELAYS.length - 1);
    for (const url of urls) {
      assert.ok(NOSTR_RELAYS.includes(url as (typeof NOSTR_RELAYS)[number]));
    }
    const content = JSON.parse(pool.lastPublished!.content) as {
      lastSeenAt: { ponder: number };
    };
    assert.equal(content.lastSeenAt.ponder, 50);
  });

  it("published content carries max() when relay watermark exceeds local", async () => {
    const pool = makeTestPool({
      defaultScript: {
        mode: "eose",
        events: [
          makeEvent({
            created_at: 20,
            content: JSON.stringify({
              lastSeenAt: { ponder: 100, nostr: 0, watchlist: 0 },
            }),
          }),
        ],
      },
    });
    setAppEventStorePoolForTest(pool);

    await saveNotificationState(
      { lastSeenAt: { ponder: 50, nostr: 0, watchlist: 0 } },
      PRIVATE_KEY,
    );

    assert.equal(pool.publishCount, 1);
    const content = JSON.parse(pool.lastPublished!.content) as {
      lastSeenAt: { ponder: number; nostr: number; watchlist: number };
    };
    assert.deepEqual(content.lastSeenAt, { ponder: 100, nostr: 0, watchlist: 0 });
  });

  it("overlapping saves serialize; later publish carries higher input merged with relay", async () => {
    const order: string[] = [];
    let writeGeneration = 0;
    const publishedContents: string[] = [];

    setAppEventStorePoolForTest({
      async ensureRelay(_url) {
        const gen = writeGeneration;
        if (!order.includes(`read-${gen}`)) {
          order.push(`read-${gen}`);
        }
        const relay: AppEventRelay = {
          subscribe(_filters, params) {
            queueMicrotask(() => {
              params.oneose?.();
            });
            return { close: () => params.onclose?.("closed") };
          },
        };
        return relay;
      },
      publish(urls, event) {
        order.push(`publish-${writeGeneration}`);
        publishedContents.push(event.content);
        writeGeneration += 1;
        return urls.map(() => Promise.resolve("ok"));
      },
    });

    await Promise.all([
      saveNotificationState(
        { lastSeenAt: { ponder: 50, nostr: 0, watchlist: 0 } },
        PRIVATE_KEY,
      ),
      saveNotificationState(
        { lastSeenAt: { ponder: 100, nostr: 0, watchlist: 0 } },
        PRIVATE_KEY,
      ),
    ]);

    assert.deepEqual(order, ["read-0", "publish-0", "read-1", "publish-1"]);
    assert.equal(publishedContents.length, 2);
    const first = JSON.parse(publishedContents[0]!) as {
      lastSeenAt: { ponder: number };
    };
    const second = JSON.parse(publishedContents[1]!) as {
      lastSeenAt: { ponder: number };
    };
    assert.equal(first.lastSeenAt.ponder, 50);
    assert.equal(second.lastSeenAt.ponder, 100);
  });
});

describe("notification fold / max survival", () => {
  it("markRead watermark on prev survives remote fold (in-flight mark)", () => {
    // Hydrate local 0 → markRead ponder=50 while remote load in flight → remote returns 30
    const prev = { lastSeenAt: { ponder: 50, nostr: 0, watchlist: 0 } };
    const remote = { lastSeenAt: { ponder: 30, nostr: 0, watchlist: 0 } };
    const folded = mergeNotificationStates(prev, remote);
    assert.equal(folded.lastSeenAt.ponder, 50);
  });

  it("relay copy higher than local floor is not regressed", () => {
    const localFloor = { lastSeenAt: { ponder: 50, nostr: 0, watchlist: 0 } };
    const relay = { lastSeenAt: { ponder: 100, nostr: 40, watchlist: 0 } };
    const folded = mergeNotificationStates(localFloor, relay);
    assert.deepEqual(folded.lastSeenAt, { ponder: 100, nostr: 40, watchlist: 0 });
  });
});
