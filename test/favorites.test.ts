import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Event } from "nostr-tools";

import { FAVORITES_LIST_ID, setAppEventStorePoolForTest } from "../lib/nostr/app-event-store.ts";
import {
  addFavorite,
  loadFavorites,
  removeFavorite,
} from "../lib/nostr/favorites.ts";
import { nostrPubkeyFromPrivateKey } from "../lib/nostr/nostr-client.ts";

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

afterEach(() => {
  setAppEventStorePoolForTest(null);
});

describe("loadFavorites", () => {
  it("merge-reads multiple events", async () => {
    const now = Math.floor(Date.now() / 1000);
    const events = [
      makeEvent({
        created_at: now - 300,
        content: JSON.stringify({ v: 1, items: { "1": { a: now - 300 } }, removed: {} }),
      }),
      makeEvent({
        created_at: now - 100,
        content: JSON.stringify({
          v: 1,
          items: { "2": { a: now - 100 } },
          removed: { "1": { r: now - 200 } },
        }),
      }),
    ];

    setAppEventStorePoolForTest({
      querySync: async () => events,
      publish: () => [],
    });

    const ids = await loadFavorites(PUBKEY);
    assert.deepEqual(ids, ["2"]);
  });
});

describe("addFavorite fail-closed", () => {
  it("returns false when querySync throws", async () => {
    setAppEventStorePoolForTest({
      querySync: async () => {
        throw new Error("relay down");
      },
      publish: () => [],
    });

    const ok = await addFavorite("99", PRIVATE_KEY);
    assert.equal(ok, false);
  });
});

describe("removeFavorite fail-closed", () => {
  it("returns false when querySync throws", async () => {
    setAppEventStorePoolForTest({
      querySync: async () => {
        throw new Error("relay down");
      },
      publish: () => [],
    });

    const ok = await removeFavorite("99", PRIVATE_KEY);
    assert.equal(ok, false);
  });
});

describe("serialized ops ordering", () => {
  it("serialized ops run in order for same pubkey", async () => {
    const order: string[] = [];
    const stored = new Set<string>();

    setAppEventStorePoolForTest({
      querySync: async () => {
        order.push("read");
        const items: Record<string, { a: number }> = {};
        for (const id of stored) {
          items[id] = { a: 1 };
        }
        return stored.size === 0
          ? []
          : [
              makeEvent({
                created_at: 1,
                content: JSON.stringify({ v: 1, items, removed: {} }),
              }),
            ];
      },
      publish: () => {
        order.push("publish");
        return ["wss://relay.damus.io"].map(() => Promise.resolve("id"));
      },
    });

    const first = addFavorite("a", PRIVATE_KEY).then((ok) => {
      if (ok) stored.add("a");
      order.push("add-done");
      return ok;
    });
    const second = addFavorite("b", PRIVATE_KEY).then((ok) => {
      if (ok) stored.add("b");
      order.push("b-done");
      return ok;
    });

    await Promise.all([first, second]);

    const readIndices = order
      .map((step, index) => (step === "read" ? index : -1))
      .filter((index) => index >= 0);
    const publishIndices = order
      .map((step, index) => (step === "publish" ? index : -1))
      .filter((index) => index >= 0);

    assert.equal(readIndices.length, 2);
    assert.equal(publishIndices.length, 2);
    assert.ok(readIndices[0] < publishIndices[0]);
    assert.ok(publishIndices[0] < readIndices[1]);
    assert.ok(readIndices[1] < publishIndices[1]);
  });
});
