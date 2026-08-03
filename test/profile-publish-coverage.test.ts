import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Event } from "nostr-tools";

import {
  setAppEventStorePoolForTest,
  type AppEventQueryPool,
  type AppEventRelay,
} from "../lib/nostr/app-event-store.ts";
import { nostrPubkeyFromPrivateKey } from "../lib/nostr/nostr-client.ts";
import { publishNostrProfile } from "../lib/nostr/profile.ts";
import type { NostrPublishPool } from "../lib/nostr/publish-event.ts";
import { KARGAIN_RELAY, NOSTR_RELAYS } from "../lib/nostr/relays.ts";

const PRIVATE_KEY = `0x${"11".repeat(32)}` as const;
const PUBKEY = nostrPubkeyFromPrivateKey(PRIVATE_KEY);
const WALLET = "0x1111111111111111111111111111111111111111" as const;

type RelayScript =
  | { mode: "eose"; events?: Event[] }
  | { mode: "close-before-eose" }
  | { mode: "ensure-reject" };

type TestPool = AppEventQueryPool &
  NostrPublishPool & {
    publishedUrls: string[][];
    publishCount: number;
    ensureRelayCount: number;
    lastPublished: Event | null;
  };

function makeEvent(overrides: Partial<Event> & Pick<Event, "created_at" | "content">): Event {
  return {
    id: "dd".repeat(32),
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

const noopSigner = { signMessage: async () => "0x" + "ab".repeat(65) };

afterEach(() => {
  setAppEventStorePoolForTest(null);
});

describe("publishNostrProfile sole kind:0 writer", () => {
  it("returns false and does not publish when no relay answered", async () => {
    const pool = makeTestPool({ defaultScript: { mode: "close-before-eose" } });
    setAppEventStorePoolForTest(pool);

    const ok = await publishNostrProfile(
      { name: "Ada" },
      WALLET,
      noopSigner,
      { privateKeyHex: PRIVATE_KEY },
    );

    assert.equal(ok, false);
    assert.equal(pool.publishCount, 0);
  });

  it("publishes only to answered relays when a subset answered", async () => {
    const pool = makeTestPool({
      defaultScript: {
        mode: "eose",
        events: [
          makeEvent({
            created_at: 10,
            content: JSON.stringify({ name: "Old", nip05: "a@example.com" }),
          }),
        ],
      },
      scripts: { [KARGAIN_RELAY]: { mode: "close-before-eose" } },
    });
    setAppEventStorePoolForTest(pool);

    const ok = await publishNostrProfile(
      { name: "New" },
      WALLET,
      noopSigner,
      { privateKeyHex: PRIVATE_KEY },
    );

    assert.equal(ok, true);
    assert.equal(pool.publishCount, 1);
    const targets = pool.publishedUrls[0]!;
    assert.ok(!targets.includes(KARGAIN_RELAY));
    assert.equal(targets.length, NOSTR_RELAYS.length - 1);
    for (const url of targets) {
      assert.ok(NOSTR_RELAYS.includes(url));
    }
  });

  it("succeeds on answered-but-empty read (first profile)", async () => {
    const pool = makeTestPool({ defaultScript: { mode: "eose", events: [] } });
    setAppEventStorePoolForTest(pool);

    const ok = await publishNostrProfile(
      { name: "First" },
      WALLET,
      noopSigner,
      { privateKeyHex: PRIVATE_KEY },
    );

    assert.equal(ok, true);
    assert.equal(pool.publishCount, 1);
    assert.deepEqual(pool.publishedUrls[0], [...NOSTR_RELAYS]);
    const content = JSON.parse(pool.lastPublished!.content) as Record<string, unknown>;
    assert.equal(content.name, "First");
  });

  it("preserves attestation and ethereum i-tag across a subset-answered publish", async () => {
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
              nip05: "ada@example.com",
            }),
            tags: [["i", `ethereum:${WALLET.toLowerCase()}`]],
          }),
        ],
      },
      scripts: { [KARGAIN_RELAY]: { mode: "close-before-eose" } },
    });
    setAppEventStorePoolForTest(pool);

    const ok = await publishNostrProfile(
      { about: "Updated" },
      WALLET,
      noopSigner,
      { privateKeyHex: PRIVATE_KEY, attestation },
    );

    assert.equal(ok, true);
    assert.equal(pool.publishCount, 1);
    const published = pool.lastPublished!;
    assert.deepEqual(published.tags, [["i", `ethereum:${WALLET.toLowerCase()}`]]);
    const content = JSON.parse(published.content) as Record<string, unknown>;
    assert.deepEqual(content.attestation, attestation);
    assert.equal(content.name, "Ada");
    assert.equal(content.about, "Updated");
    assert.equal(content.nip05, "ada@example.com");
    assert.ok(!pool.publishedUrls[0]!.includes(KARGAIN_RELAY));
  });

  it("performs exactly one coverage round per publish", async () => {
    const pool = makeTestPool({
      defaultScript: {
        mode: "eose",
        events: [makeEvent({ created_at: 1, content: "{}" })],
      },
    });
    setAppEventStorePoolForTest(pool);

    await publishNostrProfile(
      { name: "Once" },
      WALLET,
      noopSigner,
      { privateKeyHex: PRIVATE_KEY },
    );
    assert.equal(pool.ensureRelayCount, NOSTR_RELAYS.length);
  });
});
