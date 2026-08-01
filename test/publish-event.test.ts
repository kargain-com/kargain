import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Event } from "nostr-tools";

import { KARGAIN_RELAY, NOSTR_RELAYS } from "../lib/nostr/relays.ts";
import {
  publishSignedEvent,
  type NostrPublishPool,
  type PublishSignedEventResult,
} from "../lib/nostr/publish-event.ts";

const SIGNED_EVENT = {
  id: "aa".repeat(32),
  pubkey: "bb".repeat(32),
  created_at: 1_700_000_000,
  kind: 1,
  tags: [],
  content: "hello",
  sig: "cc".repeat(64),
} satisfies Event;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function makePool(
  handlers: Partial<Record<(typeof NOSTR_RELAYS)[number], () => Promise<string>>>,
): NostrPublishPool {
  return {
    publish(urls, _event) {
      return urls.map((url) => {
        const handler = handlers[url as (typeof NOSTR_RELAYS)[number]];
        if (!handler) {
          return Promise.reject(new Error(`no handler for ${url}`));
        }
        return handler();
      });
    },
  };
}

async function assertPublish(
  result: PublishSignedEventResult,
  expected: { ok: boolean; ownRelayAck: boolean },
): Promise<void> {
  assert.equal(result.ok, expected.ok);
  assert.equal(await result.ownRelayAck, expected.ownRelayAck);
}

describe("publishSignedEvent", () => {
  it("returns ok and ownRelayAck when only own relay acks", async () => {
    const pool = makePool({
      [KARGAIN_RELAY]: async () => SIGNED_EVENT.id,
    });

    const result = await publishSignedEvent(pool, SIGNED_EVENT);

    await assertPublish(result, { ok: true, ownRelayAck: true });
  });

  it("returns ok true and ownRelayAck false when only a public relay acks", async () => {
    const pool = makePool({
      [KARGAIN_RELAY]: async () => {
        throw new Error("own relay down");
      },
      "wss://relay.damus.io": async () => SIGNED_EVENT.id,
    });

    const result = await publishSignedEvent(pool, SIGNED_EVENT);

    await assertPublish(result, { ok: true, ownRelayAck: false });
  });

  it("returns ok false and ownRelayAck false when all relays fail", async () => {
    const pool = makePool(
      Object.fromEntries(
        NOSTR_RELAYS.map((relay) => [relay, async () => { throw new Error("fail"); }]),
      ) as Partial<Record<(typeof NOSTR_RELAYS)[number], () => Promise<string>>>,
    );

    const result = await publishSignedEvent(pool, SIGNED_EVENT, { ownRelayTimeoutMs: 50 });

    await assertPublish(result, { ok: false, ownRelayAck: false });
  });

  it("resolves ok fast when public acks before own relay", async () => {
    const pool = makePool({
      [KARGAIN_RELAY]: async () => {
        await sleep(100);
        return SIGNED_EVENT.id;
      },
      "wss://relay.damus.io": async () => {
        await sleep(10);
        return SIGNED_EVENT.id;
      },
    });

    const started = Date.now();
    const result = await publishSignedEvent(pool, SIGNED_EVENT);
    const elapsed = Date.now() - started;

    assert.equal(result.ok, true);
    assert.ok(elapsed < 500, `expected fast ok resolution, took ${elapsed}ms`);
    assert.equal(await result.ownRelayAck, true);
  });

  it("returns ownRelayAck false when own relay times out", async () => {
    const pool = makePool({
      [KARGAIN_RELAY]: async () => {
        await sleep(200);
        return SIGNED_EVENT.id;
      },
      "wss://relay.damus.io": async () => SIGNED_EVENT.id,
    });

    const result = await publishSignedEvent(pool, SIGNED_EVENT, { ownRelayTimeoutMs: 50 });

    await assertPublish(result, { ok: true, ownRelayAck: false });
  });

  it("publishes only to an explicit relays list", async () => {
    const seen: string[][] = [];
    const pool: NostrPublishPool = {
      publish(urls) {
        seen.push([...urls]);
        return urls.map(() => Promise.resolve(SIGNED_EVENT.id));
      },
    };

    const targets = ["wss://relay.damus.io", "wss://nos.lol"] as const;
    const result = await publishSignedEvent(pool, SIGNED_EVENT, { relays: targets });

    assert.equal(result.ok, true);
    assert.deepEqual(seen, [[...targets]]);
    assert.equal(await result.ownRelayAck, false);
  });
});
