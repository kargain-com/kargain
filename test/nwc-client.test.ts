import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";
import * as nip04 from "nostr-tools/nip04";
import type { Event } from "nostr-tools";

import {
  __testing,
  fetchWalletInfo,
  payInvoice,
  type NwcPayResult,
} from "@/lib/nostr/nwc/nwc-client";
import type { ParsedNwcConnection } from "@/lib/nostr/nwc/nwc-uri";

const { parseInfoContent, parseInfoEncryption, mapNwcErrorCode, KIND_NWC_REQUEST, KIND_NWC_RESPONSE } =
  __testing;

const CLIENT_SECRET = "1111111111111111111111111111111111111111111111111111111111111111";
const WALLET_SECRET_BYTES = generateSecretKey();
const WALLET_PUBKEY = getPublicKey(WALLET_SECRET_BYTES);
const RELAY = "wss://relay.example.com";

const conn: ParsedNwcConnection = {
  walletPubkey: WALLET_PUBKEY,
  relayUrl: RELAY,
  secretHex: CLIENT_SECRET,
};

type MockPool = {
  querySync: (
    relays: string[],
    filter: { kinds?: number[]; authors?: string[]; limit?: number },
    opts?: { maxWait?: number },
  ) => Promise<Event[]>;
  subscribe: (
    relays: string[],
    filter: Record<string, unknown>,
    handlers: { onevent: (event: Event) => void },
  ) => { close: () => void };
  publish: (relays: string[], event: Event) => Promise<string[]>;
};

function makeInfoEvent(content: string, encryptionTag?: string): Event {
  const tags = encryptionTag ? [["encryption", encryptionTag]] : [];
  return finalizeEvent(
    {
      kind: 13194,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content,
    },
    new Uint8Array(32).fill(2),
  );
}

describe("nwc info parsing", () => {
  it("detects pay_invoice support", () => {
    const parsed = parseInfoContent("get_info pay_invoice list_transactions");
    assert.equal(parsed.supportsPayInvoice, true);
  });

  it("prefers nip44 encryption tag", () => {
    assert.equal(parseInfoEncryption([["encryption", "nip04"], ["encryption", "nip44_v2"]]), "nip44");
    assert.equal(parseInfoEncryption([["encryption", "nip04"]]), "nip04");
  });

  it("returns unsupported when info event missing", async () => {
    const pool: MockPool = {
      querySync: async () => [],
      subscribe: () => ({ close: () => {} }),
      publish: async () => [],
    };
    const info = await fetchWalletInfo(conn, { pool: pool as never, timeoutMs: 50 });
    assert.equal(info.supportsPayInvoice, false);
    assert.equal(info.encryption, "nip04");
  });

  it("parses info event methods and encryption", async () => {
    const pool: MockPool = {
      querySync: async () => [makeInfoEvent("pay_invoice get_balance", "nip44_v2")],
      subscribe: () => ({ close: () => {} }),
      publish: async () => [],
    };
    const info = await fetchWalletInfo(conn, { pool: pool as never, timeoutMs: 50 });
    assert.equal(info.supportsPayInvoice, true);
    assert.equal(info.encryption, "nip44");
  });
});

describe("payInvoice", () => {
  it("maps success with preimage", async () => {
    const callOrder: string[] = [];
    let publishEvent: Event | null = null;

    const pool: MockPool = {
      querySync: async () => [],
      subscribe: (_relays, _filter, handlers) => {
        callOrder.push("subscribe");
        queueMicrotask(async () => {
          if (!publishEvent) return;
          const payload = nip04.encrypt(
            CLIENT_SECRET,
            WALLET_PUBKEY,
            JSON.stringify({ result: { preimage: "00deadbeef" } }),
          );
          handlers.onevent(
            finalizeEvent(
              {
                kind: KIND_NWC_RESPONSE,
                created_at: Math.floor(Date.now() / 1000),
                tags: [
                  ["p", getPublicKey(new Uint8Array(Buffer.from(CLIENT_SECRET, "hex")))],
                  ["e", publishEvent.id],
                ],
                content: payload,
              },
              new Uint8Array(32).fill(3),
            ),
          );
        });
        return { close: () => callOrder.push("close") };
      },
      publish: (_relays, event) => {
        callOrder.push("publish");
        publishEvent = event;
        return [Promise.resolve("")];
      },
    };

    const result = await payInvoice(conn, "lnbc1test", {
      pool: pool as never,
      timeoutMs: 500,
      encryption: "nip04",
    });

    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.preimage, "00deadbeef");
    assert.deepEqual(callOrder.slice(0, 2), ["subscribe", "publish"]);
    assert.ok(callOrder.includes("close"));
  });

  it("maps missing preimage to invalid_response", async () => {
    const pool = makeResponsePool(JSON.stringify({ result: {} }));
    const result = await payInvoice(conn, "lnbc1test", {
      pool: pool as never,
      timeoutMs: 500,
      encryption: "nip04",
    });
    assert.deepEqual(result, { ok: false, code: "invalid_response" });
  });

  it("maps error codes", async () => {
    const cases: Array<[string, NwcPayResult]> = [
      ["INSUFFICIENT_BALANCE", { ok: false, code: "insufficient_balance" }],
      ["NOT_AUTHORIZED", { ok: false, code: "rejected" }],
      ["RESTRICTED", { ok: false, code: "rejected" }],
      ["QUOTA_EXCEEDED", { ok: false, code: "rejected" }],
      ["UNKNOWN", { ok: false, code: "invalid_response" }],
    ];

    for (const [code, expected] of cases) {
      const pool = makeResponsePool(JSON.stringify({ error: { code } }));
      const result = await payInvoice(conn, "lnbc1test", {
        pool: pool as never,
        timeoutMs: 500,
        encryption: "nip04",
      });
      assert.deepEqual(result, expected, code);
    }
  });

  it("maps malformed JSON to invalid_response", async () => {
    const pool = makeResponsePool("not-json", { raw: true });
    const result = await payInvoice(conn, "lnbc1test", {
      pool: pool as never,
      timeoutMs: 500,
      encryption: "nip04",
    });
    assert.deepEqual(result, { ok: false, code: "invalid_response" });
  });
});

describe("mapNwcErrorCode unit", () => {
  it("maps known codes", () => {
    assert.equal(mapNwcErrorCode("INSUFFICIENT_BALANCE"), "insufficient_balance");
    assert.equal(mapNwcErrorCode("NOT_AUTHORIZED"), "rejected");
  });
});

function makeResponsePool(content: string, opts?: { raw?: boolean }): MockPool {
  let publishEvent: Event | null = null;
  const ourPubkey = getPublicKey(new Uint8Array(Buffer.from(CLIENT_SECRET, "hex")));

  return {
    querySync: async () => [],
    subscribe: (_relays, _filter, handlers) => {
      queueMicrotask(async () => {
        if (!publishEvent) return;
        const payload = opts?.raw
          ? content
          : nip04.encrypt(CLIENT_SECRET, WALLET_PUBKEY, content);
        handlers.onevent(
          finalizeEvent(
            {
              kind: KIND_NWC_RESPONSE,
              created_at: Math.floor(Date.now() / 1000),
              tags: [["p", ourPubkey], ["e", publishEvent.id]],
              content: payload,
            },
            new Uint8Array(32).fill(4),
          ),
        );
      });
      return { close: () => {} };
    },
    publish: (_relays, event) => {
      publishEvent = event;
      assert.equal(event.kind, KIND_NWC_REQUEST);
      return [Promise.resolve("")];
    },
  };
}
