import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Event } from "nostr-tools";

import {
  setAppEventStorePoolForTest,
  type AppEventQueryPool,
  type AppEventRelay,
} from "../lib/nostr/app-event-store.ts";
import { nostrPubkeyFromPrivateKey } from "../lib/nostr/nostr-client.ts";
import { saveCachedPubkey, clearCachedPubkey } from "../lib/nostr/nostr-pubkey-cache.ts";
import {
  readMessagingIntent,
} from "../lib/nostr/messaging-intent.ts";
import { publishNostrProfile } from "../lib/nostr/profile.ts";
import type { NostrPublishPool } from "../lib/nostr/publish-event.ts";
import { KARGAIN_RELAY, NOSTR_RELAYS } from "../lib/nostr/relays.ts";

const PRIVATE_KEY = `0x${"11".repeat(32)}` as const;
const PUBKEY = nostrPubkeyFromPrivateKey(PRIVATE_KEY);
const WALLET = "0x1111111111111111111111111111111111111111" as const;

const memoryStore = new Map<string, string>();

function installLocalStorage(): void {
  memoryStore.clear();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem(key: string) {
        return memoryStore.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        memoryStore.set(key, value);
      },
      removeItem(key: string) {
        memoryStore.delete(key);
      },
    },
  };
}

type RelayScript =
  | { mode: "eose"; events?: Event[]; delayMs?: number }
  | { mode: "close-before-eose" }
  | { mode: "ensure-reject" };

type TestPool = AppEventQueryPool &
  NostrPublishPool & {
    publishedUrls: string[][];
    publishCount: number;
    ensureRelayCount: number;
    lastPublished: Event | null;
  };

function makeEvent(
  overrides: Partial<Event> & Pick<Event, "created_at" | "content">,
): Event {
  return {
    id: overrides.id ?? `id${overrides.created_at}${Math.random().toString(16).slice(2)}`,
    pubkey: PUBKEY,
    kind: 0,
    tags: [["i", `ethereum:${WALLET.toLowerCase()}`]],
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
  let ensureRelayCount = 0;
  let lastPublished: Event | null = null;
  const defaultScript: RelayScript = options.defaultScript ?? { mode: "eose", events: [] };
  const scripts = options.scripts ?? {};
  const publishOk = options.publishOk ?? true;

  const pool: TestPool = {
    publishedUrls,
    get publishCount() {
      return publishCount;
    },
    get ensureRelayCount() {
      return ensureRelayCount;
    },
    get lastPublished() {
      return lastPublished;
    },
    async ensureRelay(url) {
      ensureRelayCount += 1;
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

          const fire = () => {
            if (closed) return;
            if (script.mode === "close-before-eose") {
              close();
              return;
            }
            for (const event of script.events ?? []) {
              params.onevent?.(event);
            }
            params.oneose?.();
          };

          const delayMs = script.mode === "eose" ? (script.delayMs ?? 0) : 0;
          if (delayMs > 0) {
            setTimeout(fire, delayMs);
          } else {
            queueMicrotask(fire);
          }

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

const noopSigner = { signMessage: async () => "0x" + "ab".repeat(65) };

afterEach(() => {
  setAppEventStorePoolForTest(null);
  clearCachedPubkey(WALLET);
  memoryStore.clear();
});

describe("messaging intent + kind:0 writer boundary", () => {
  it("read: unanswered when no relay answers", async () => {
    installLocalStorage();
    saveCachedPubkey(WALLET, PUBKEY);
    const pool = makeTestPool({ defaultScript: { mode: "close-before-eose" } });
    setAppEventStorePoolForTest(pool);

    const result = await readMessagingIntent(WALLET);
    assert.equal(result.status, "unanswered");
  });

  it("read: answered with null when relays answer and flag is absent", async () => {
    installLocalStorage();
    saveCachedPubkey(WALLET, PUBKEY);
    const pool = makeTestPool({
      defaultScript: {
        mode: "eose",
        events: [makeEvent({ created_at: 10, content: JSON.stringify({ name: "Ada" }) })],
      },
    });
    setAppEventStorePoolForTest(pool);

    const result = await readMessagingIntent(WALLET);
    assert.equal(result.status, "answered");
    if (result.status === "answered") {
      assert.equal(result.intent, null);
    }
  });

  it("read: slower relay with newer profile wins (coverage, not wall-clock first)", async () => {
    installLocalStorage();
    saveCachedPubkey(WALLET, PUBKEY);
    const older = makeEvent({
      id: "aa".repeat(32),
      created_at: 100,
      content: JSON.stringify({ messagesEnabled: false }),
    });
    const newer = makeEvent({
      id: "bb".repeat(32),
      created_at: 200,
      content: JSON.stringify({ messagesEnabled: true }),
    });
    const otherRelays = NOSTR_RELAYS.filter((u) => u !== KARGAIN_RELAY);
    const scripts: Partial<Record<string, RelayScript>> = {
      [KARGAIN_RELAY]: { mode: "eose", events: [newer], delayMs: 40 },
    };
    for (const url of otherRelays) {
      scripts[url] = { mode: "eose", events: [older], delayMs: 0 };
    }
    const pool = makeTestPool({ scripts, defaultScript: { mode: "close-before-eose" } });
    setAppEventStorePoolForTest(pool);

    const result = await readMessagingIntent(WALLET);
    assert.equal(result.status, "answered");
    if (result.status === "answered") {
      assert.equal(result.intent, true);
    }
  });

  it("publish refuses when no relay answered", async () => {
    const pool = makeTestPool({ defaultScript: { mode: "close-before-eose" } });
    setAppEventStorePoolForTest(pool);

    const ok = await publishNostrProfile(
      { messagesEnabled: false },
      WALLET,
      noopSigner,
      { privateKeyHex: PRIVATE_KEY },
    );
    assert.equal(ok, false);
    assert.equal(pool.publishCount, 0);
  });

  it("publish targets only answered relays", async () => {
    const pool = makeTestPool({
      defaultScript: {
        mode: "eose",
        events: [
          makeEvent({
            created_at: 10,
            content: JSON.stringify({ name: "Old" }),
          }),
        ],
      },
      scripts: { [KARGAIN_RELAY]: { mode: "close-before-eose" } },
    });
    setAppEventStorePoolForTest(pool);

    const ok = await publishNostrProfile(
      { messagesEnabled: true },
      WALLET,
      noopSigner,
      { privateKeyHex: PRIVATE_KEY },
    );
    assert.equal(ok, true);
    assert.equal(pool.publishCount, 1);
    const targets = pool.publishedUrls[0]!;
    assert.ok(!targets.includes(KARGAIN_RELAY));
    assert.equal(targets.length, NOSTR_RELAYS.length - 1);
  });

  it("exactly one merge-base coverage round per publish", async () => {
    const pool = makeTestPool({
      defaultScript: {
        mode: "eose",
        events: [
          makeEvent({
            created_at: 10,
            content: JSON.stringify({ name: "Ada", messagesEnabled: true }),
          }),
        ],
      },
    });
    setAppEventStorePoolForTest(pool);

    const before = pool.ensureRelayCount;
    const ok = await publishNostrProfile(
      { messagesEnabled: false },
      WALLET,
      noopSigner,
      { privateKeyHex: PRIVATE_KEY },
    );
    assert.equal(ok, true);
    assert.equal(pool.ensureRelayCount - before, NOSTR_RELAYS.length);
    assert.equal(pool.publishCount, 1);
  });

  it("attestation survives a publish that does not supply one", async () => {
    const attestation = { v: 1 as const, sig: ("0x" + "ab".repeat(65)) as `0x${string}` };
    const pool = makeTestPool({
      defaultScript: {
        mode: "eose",
        events: [
          makeEvent({
            created_at: 20,
            content: JSON.stringify({
              name: "Ada",
              attestation,
              messagesEnabled: true,
            }),
          }),
        ],
      },
    });
    setAppEventStorePoolForTest(pool);

    const ok = await publishNostrProfile(
      { about: "Updated" },
      WALLET,
      noopSigner,
      { privateKeyHex: PRIVATE_KEY },
    );
    assert.equal(ok, true);
    const content = JSON.parse(pool.lastPublished!.content) as Record<string, unknown>;
    assert.deepEqual(content.attestation, attestation);
    assert.equal(content.about, "Updated");
    assert.equal(content.messagesEnabled, true);
  });

  it("supplied attestation replaces the previous one", async () => {
    const oldAtt = { v: 1 as const, sig: ("0x" + "11".repeat(65)) as `0x${string}` };
    const newAtt = { v: 1 as const, sig: ("0x" + "22".repeat(65)) as `0x${string}` };
    const pool = makeTestPool({
      defaultScript: {
        mode: "eose",
        events: [
          makeEvent({
            created_at: 20,
            content: JSON.stringify({ name: "Ada", attestation: oldAtt }),
          }),
        ],
      },
    });
    setAppEventStorePoolForTest(pool);

    const ok = await publishNostrProfile(
      { about: "x" },
      WALLET,
      noopSigner,
      { privateKeyHex: PRIVATE_KEY, attestation: newAtt },
    );
    assert.equal(ok, true);
    const content = JSON.parse(pool.lastPublished!.content) as Record<string, unknown>;
    assert.deepEqual(content.attestation, newAtt);
  });

  it("serialized overlapping writers preserve both fields", async () => {
    let baseContent: Record<string, unknown> = { name: "Ada" };
    let publishedUrls: string[][] = [];
    let lastPublished: Event | null = null;

    const pool: AppEventQueryPool & NostrPublishPool = {
      async ensureRelay() {
        const snapshot = { ...baseContent };
        const events =
          Object.keys(snapshot).length > 0
            ? [
                makeEvent({
                  created_at: Math.floor(Date.now() / 1000),
                  content: JSON.stringify(snapshot),
                  id: Buffer.from(JSON.stringify(snapshot)).toString("hex").slice(0, 64).padEnd(64, "0"),
                }),
              ]
            : [];
        const relay: AppEventRelay = {
          subscribe(_filters, params) {
            queueMicrotask(() => {
              for (const event of events) params.onevent?.(event);
              params.oneose?.();
            });
            return { close() {} };
          },
        };
        return relay;
      },
      publish(urls, event) {
        publishedUrls.push([...urls]);
        lastPublished = event;
        baseContent = JSON.parse(event.content) as Record<string, unknown>;
        return urls.map(() => Promise.resolve("ok"));
      },
    };
    setAppEventStorePoolForTest(pool);

    const p1 = publishNostrProfile(
      { messagesEnabled: true },
      WALLET,
      noopSigner,
      { privateKeyHex: PRIVATE_KEY },
    );
    const p2 = publishNostrProfile(
      { lud16: "ada@example.com" },
      WALLET,
      noopSigner,
      { privateKeyHex: PRIVATE_KEY },
    );
    const [ok1, ok2] = await Promise.all([p1, p2]);
    assert.equal(ok1, true);
    assert.equal(ok2, true);
    assert.equal(baseContent.messagesEnabled, true);
    assert.equal(baseContent.lud16, "ada@example.com");
    assert.equal(baseContent.name, "Ada");
    assert.equal(publishedUrls.length, 2);
    assert.ok(lastPublished);
  });
});
