import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Event } from "nostr-tools";

import {
  FAVORITES_LIST_ID,
  type AppEventQueryPool,
  type AppEventRelay,
  setAppEventStorePoolForTest,
} from "../lib/nostr/app-event-store.ts";
import {
  addFavorite,
  loadFavorites,
  removeFavorite,
} from "../lib/nostr/favorites.ts";
import { nostrPubkeyFromPrivateKey } from "../lib/nostr/nostr-client.ts";
import { KARGAIN_RELAY, NOSTR_RELAYS } from "../lib/nostr/relays.ts";
import type { NostrPublishPool } from "../lib/nostr/publish-event.ts";

const PRIVATE_KEY = `0x${"11".repeat(32)}` as const;
const PUBKEY = nostrPubkeyFromPrivateKey(PRIVATE_KEY);

function makeEvent(overrides: Partial<Event> & Pick<Event, "created_at" | "content">): Event {
  return {
    id: "dd".repeat(32),
    pubkey: PUBKEY,
    kind: 30000,
    tags: [["d", FAVORITES_LIST_ID]],
    sig: "cc".repeat(64),
    ...overrides,
  };
}

type RelayScript =
  | { mode: "eose"; events?: Event[] }
  | { mode: "close-before-eose" }
  | { mode: "ensure-reject"; error?: Error };

type TestPool = AppEventQueryPool &
  NostrPublishPool & {
    publishedUrls: string[][];
    publishCount: number;
  };

function makeTestPool(options: {
  scripts?: Partial<Record<string, RelayScript>>;
  defaultScript?: RelayScript;
  publishOk?: boolean;
}): TestPool {
  const publishedUrls: string[][] = [];
  let publishCount = 0;
  const defaultScript: RelayScript = options.defaultScript ?? { mode: "eose", events: [] };
  const scripts = options.scripts ?? {};
  const publishOk = options.publishOk ?? true;

  const pool: TestPool = {
    publishedUrls,
    get publishCount() {
      return publishCount;
    },
    async ensureRelay(url) {
      const script = scripts[url] ?? defaultScript;
      if (script.mode === "ensure-reject") {
        throw script.error ?? new Error(`ensureRelay failed: ${url}`);
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
    publish(urls) {
      publishCount += 1;
      publishedUrls.push([...urls]);
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

describe("loadFavorites", () => {
  it("merge-reads events from answered relays", async () => {
    const now = Math.floor(Date.now() / 1000);
    const events = [
      makeEvent({
        id: "11".repeat(32),
        created_at: now - 300,
        content: JSON.stringify({ v: 1, items: { "1": { a: now - 300 } }, removed: {} }),
      }),
      makeEvent({
        id: "22".repeat(32),
        created_at: now - 100,
        content: JSON.stringify({
          v: 1,
          items: { "2": { a: now - 100 } },
          removed: { "1": { r: now - 200 } },
        }),
      }),
    ];

    setAppEventStorePoolForTest(
      makeTestPool({
        defaultScript: { mode: "eose", events },
      }),
    );

    const ids = await loadFavorites(PUBKEY);
    assert.deepEqual(ids, ["2"]);
  });

  it("returns empty when no relay answered", async () => {
    setAppEventStorePoolForTest(
      makeTestPool({
        defaultScript: { mode: "close-before-eose" },
      }),
    );

    const ids = await loadFavorites(PUBKEY);
    assert.deepEqual(ids, []);
  });
});

describe("addFavorite / removeFavorite coverage gate", () => {
  it("returns false and does not publish when no relay answered", async () => {
    const pool = makeTestPool({
      defaultScript: { mode: "close-before-eose" },
    });
    setAppEventStorePoolForTest(pool);

    assert.equal(await addFavorite("99", PRIVATE_KEY), false);
    assert.equal(pool.publishCount, 0);

    assert.equal(await removeFavorite("99", PRIVATE_KEY), false);
    assert.equal(pool.publishCount, 0);
  });

  it("publishes only to answered relays when a subset answered", async () => {
    const answered = [KARGAIN_RELAY, "wss://relay.damus.io"] as const;
    const scripts: Partial<Record<string, RelayScript>> = {};
    for (const url of NOSTR_RELAYS) {
      scripts[url] = answered.includes(url as (typeof answered)[number])
        ? { mode: "eose", events: [] }
        : { mode: "close-before-eose" };
    }

    const pool = makeTestPool({ scripts });
    setAppEventStorePoolForTest(pool);

    assert.equal(await addFavorite("42", PRIVATE_KEY), true);
    assert.equal(pool.publishCount, 1);
    assert.deepEqual(pool.publishedUrls[0], [...answered]);
    for (const url of pool.publishedUrls[0]) {
      assert.ok(answered.includes(url as (typeof answered)[number]));
    }
  });

  it("succeeds on answered-but-empty read (first favorite)", async () => {
    const pool = makeTestPool({
      defaultScript: { mode: "eose", events: [] },
    });
    setAppEventStorePoolForTest(pool);

    assert.equal(await addFavorite("1", PRIVATE_KEY), true);
    assert.equal(pool.publishCount, 1);
    assert.deepEqual(pool.publishedUrls[0], [...NOSTR_RELAYS]);
  });

  it("treats onclose before EOSE as unanswered for that relay", async () => {
    const scripts: Partial<Record<string, RelayScript>> = {};
    for (const url of NOSTR_RELAYS) {
      scripts[url] =
        url === KARGAIN_RELAY
          ? { mode: "close-before-eose" }
          : { mode: "eose", events: [] };
    }

    const pool = makeTestPool({ scripts });
    setAppEventStorePoolForTest(pool);

    assert.equal(await addFavorite("7", PRIVATE_KEY), true);
    assert.equal(pool.publishCount, 1);
    assert.ok(!pool.publishedUrls[0].includes(KARGAIN_RELAY));
    assert.equal(pool.publishedUrls[0].length, NOSTR_RELAYS.length - 1);
  });

  it("defence in depth: ensureRelay reject-all returns false and does not publish", async () => {
    const pool = makeTestPool({
      defaultScript: { mode: "ensure-reject", error: new Error("all down") },
    });
    setAppEventStorePoolForTest(pool);

    assert.equal(await addFavorite("99", PRIVATE_KEY), false);
    assert.equal(pool.publishCount, 0);
  });
});

describe("serialized ops ordering", () => {
  it("serialized ops run in order for same pubkey", async () => {
    const order: string[] = [];
    let writeGeneration = 0;

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
      publish(urls) {
        order.push(`publish-${writeGeneration}`);
        writeGeneration += 1;
        return urls.map(() => Promise.resolve("ok"));
      },
    });

    await Promise.all([addFavorite("a", PRIVATE_KEY), addFavorite("b", PRIVATE_KEY)]);

    assert.deepEqual(order, ["read-0", "publish-0", "read-1", "publish-1"]);
  });
});
