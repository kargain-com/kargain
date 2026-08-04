import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  purgeLegacyMessagingKeysForTest,
  resetLegacyPurgeFlagForTest,
  createMessagingCachePort,
  readPendingReceipts,
  writePendingReceipts,
  clearPendingReceipts,
} from "../lib/messaging/adapters/cache-adapter.ts";
import {
  loadConversationSummaries,
  sortConversationSummaries,
  sumUnreadCounts,
  type ConversationSummary,
} from "../lib/messaging/conversations.ts";

function summary(
  id: string,
  lastMessageAt: Date | null,
  unreadCount = 0,
): ConversationSummary {
  return {
    id,
    peerAddress: "0x0000000000000000000000000000000000000001",
    lastMessage: "hello",
    lastMessageAt,
    unreadCount,
  };
}

describe("sortConversationSummaries", () => {
  it("orders by lastMessageAt descending", () => {
    const sorted = sortConversationSummaries([
      summary("a", new Date("2026-01-01T00:00:00Z")),
      summary("b", new Date("2026-01-03T00:00:00Z")),
      summary("c", new Date("2026-01-02T00:00:00Z")),
    ]);

    assert.deepEqual(
      sorted.map((row) => row.id),
      ["b", "c", "a"],
    );
  });

  it("treats missing timestamps as oldest", () => {
    const sorted = sortConversationSummaries([
      summary("none", null),
      summary("recent", new Date("2026-01-02T00:00:00Z")),
    ]);

    assert.deepEqual(
      sorted.map((row) => row.id),
      ["recent", "none"],
    );
  });
});

describe("sumUnreadCounts", () => {
  it("sums unread across conversations", () => {
    const total = sumUnreadCounts([
      summary("a", null, 2),
      summary("b", null, 0),
      summary("c", null, 5),
    ]);

    assert.equal(total, 7);
  });
});

type FakeDm = {
  id: string;
  peerInboxId: () => Promise<string>;
  lastMessage: () => Promise<null | { content: string; contentType?: { authorityId: string; typeId: string }; sentAt?: Date }>;
  lastReadTimes: () => Promise<Map<string, bigint>>;
  messages: (opts?: {
    sentAfterNs?: bigint;
    excludeSenderInboxIds?: string[];
    limit?: bigint;
    direction?: number;
  }) => Promise<
    Array<{
      content: string;
      contentType?: { authorityId: string; typeId: string };
      sentAt?: Date;
      senderInboxId?: string;
    }>
  >;
};

function makeFakeClient(opts: {
  dms: FakeDm[];
  inboxId: string;
  onGetInboxStates?: (ids: string[]) => void;
  onSyncAll?: () => void;
}) {
  let getInboxStatesCalls = 0;
  let syncAllCalls = 0;
  return {
    inboxId: opts.inboxId,
    getInboxStatesCalls: () => getInboxStatesCalls,
    syncAllCalls: () => syncAllCalls,
    conversations: {
      syncAll: async () => {
        syncAllCalls += 1;
        opts.onSyncAll?.();
      },
      listDms: async (_options?: { consentStates?: number[] }) => opts.dms,
    },
    preferences: {
      getInboxStates: async (ids: string[]) => {
        getInboxStatesCalls += 1;
        opts.onGetInboxStates?.(ids);
        return ids.map((inboxId) => ({
          inboxId,
          accountIdentifiers: [
            {
              identifier: `0x${inboxId.replace(/\D/g, "").padStart(40, "0").slice(0, 40)}`,
              identifierKind: 0,
            },
          ],
        }));
      },
    },
  };
}

describe("loadConversationSummaries batching", () => {
  it("issues one getInboxStates call regardless of conversation count", async () => {
    const inboxId = "self-inbox";
    const dms: FakeDm[] = Array.from({ length: 5 }, (_, i) => ({
      id: `dm-${i}`,
      peerInboxId: async () => `peer-${i}`,
      lastMessage: async () => null,
      lastReadTimes: async () => new Map([[inboxId, 0n]]),
      messages: async () => [],
    }));
    const client = makeFakeClient({ dms, inboxId });
    const summaries = await loadConversationSummaries(client as never, {
      consentStates: [1],
    });
    assert.equal(client.getInboxStatesCalls(), 1);
    assert.equal(client.syncAllCalls(), 1);
    assert.equal(summaries.length, 5);
  });

  it("unread uses protocol lastReadTimes watermark and filters protocol events", async () => {
    const inboxId = "self-inbox";
    const dms: FakeDm[] = [
      {
        id: "dm-1",
        peerInboxId: async () => "peer-1",
        lastMessage: async () => null,
        lastReadTimes: async () => new Map([[inboxId, 1_000n]]),
        messages: async (opts) => {
          if (opts?.sentAfterNs !== undefined) {
            assert.equal(opts.sentAfterNs, 1_000n);
            assert.deepEqual(opts?.excludeSenderInboxIds, [inboxId]);
            return [
              { content: "a", contentType: { authorityId: "xmtp.org", typeId: "text" } },
              {
                content: "skip",
                contentType: { authorityId: "xmtp.org", typeId: "group_updated" },
              },
              { content: "b", contentType: { authorityId: "xmtp.org", typeId: "text" } },
              { content: "c", contentType: { authorityId: "xmtp.org", typeId: "text" } },
            ];
          }
          // lastRenderablePreview walk when lastMessage is null
          return [];
        },
      },
    ];
    const client = makeFakeClient({ dms, inboxId });
    const summaries = await loadConversationSummaries(client as never, {
      consentStates: [1],
    });
    assert.equal(summaries[0]!.unreadCount, 3);
  });
});

describe("legacy last-seen purge", () => {
  const memory = new Map<string, string>();

  afterEach(() => {
    memory.clear();
    resetLegacyPurgeFlagForTest();
  });

  it("purges xmtp:lastseen keys and is idempotent", () => {
    (globalThis as { localStorage?: Storage }).localStorage = {
      get length() {
        return memory.size;
      },
      key(i: number) {
        return [...memory.keys()][i] ?? null;
      },
      getItem(key: string) {
        return memory.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        memory.set(key, value);
      },
      removeItem(key: string) {
        memory.delete(key);
      },
      clear() {
        memory.clear();
      },
    } as Storage;

    memory.set("xmtp:lastseen:abc", new Date().toISOString());
    memory.set("xmtp:lastseen:def", new Date().toISOString());
    memory.set("messaging:memo:devnet:0x1", "{}");

    resetLegacyPurgeFlagForTest();
    createMessagingCachePort("devnet");
    assert.equal(memory.has("xmtp:lastseen:abc"), false);
    assert.equal(memory.has("xmtp:lastseen:def"), false);
    assert.equal(memory.has("messaging:memo:devnet:0x1"), true);

    memory.set("xmtp:lastseen:ghi", "x");
    purgeLegacyMessagingKeysForTest();
    assert.equal(memory.has("xmtp:lastseen:ghi"), false);
    purgeLegacyMessagingKeysForTest();
    assert.equal(memory.has("xmtp:lastseen:ghi"), false);
  });
});

describe("pending receipts persistence", () => {
  const memory = new Map<string, string>();

  afterEach(() => {
    memory.clear();
  });

  it("survives reload and flush is idempotent", () => {
    (globalThis as { localStorage?: Storage }).localStorage = {
      get length() {
        return memory.size;
      },
      key(i: number) {
        return [...memory.keys()][i] ?? null;
      },
      getItem(key: string) {
        return memory.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        memory.set(key, value);
      },
      removeItem(key: string) {
        memory.delete(key);
      },
      clear() {
        memory.clear();
      },
    } as Storage;

    const env = "dev";
    const address = "0x1111111111111111111111111111111111111111";
    writePendingReceipts(env, address, ["dm-a", "dm-b"]);
    assert.deepEqual(readPendingReceipts(env, address), ["dm-a", "dm-b"]);

    // Simulate reload — new read from storage.
    assert.deepEqual(readPendingReceipts(env, address), ["dm-a", "dm-b"]);

    writePendingReceipts(env, address, ["dm-b"]);
    assert.deepEqual(readPendingReceipts(env, address), ["dm-b"]);
    writePendingReceipts(env, address, ["dm-b"]);
    assert.deepEqual(readPendingReceipts(env, address), ["dm-b"]);
    clearPendingReceipts(env, address);
    assert.deepEqual(readPendingReceipts(env, address), []);
    clearPendingReceipts(env, address);
    assert.deepEqual(readPendingReceipts(env, address), []);
  });

  it("uses memory fallback when localStorage is unavailable", () => {
    const prev = (globalThis as { localStorage?: Storage }).localStorage;
    Reflect.deleteProperty(globalThis, "localStorage");

    const env = "dev";
    const address = "0x2222222222222222222222222222222222222222";
    writePendingReceipts(env, address, ["dm-mem"]);
    assert.deepEqual(readPendingReceipts(env, address), ["dm-mem"]);
    clearPendingReceipts(env, address);
    assert.deepEqual(readPendingReceipts(env, address), []);

    if (prev !== undefined) {
      Object.defineProperty(globalThis, "localStorage", {
        value: prev,
        configurable: true,
        writable: true,
      });
    }
  });
});
