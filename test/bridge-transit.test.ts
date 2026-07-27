import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  bridgeTransitSessionKey,
  clearBridgeTransitRecord,
  deriveBridgeTransitUi,
  isBridgeTransitActivePhase,
  mergeProfilePassportWithTransit,
  parseBridgeTransitRecord,
  readBridgeTransitRecord,
  reconcileBridgeTransit,
  writeBridgeTransitRecord,
  type BridgeTransitRecord,
  type TransitStorage,
} from "../lib/passport/bridge-transit.ts";

function memoryStorage(): TransitStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem(key) {
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      data.set(key, value);
    },
    removeItem(key) {
      data.delete(key);
    },
  };
}

function baseRecord(
  overrides: Partial<BridgeTransitRecord> = {},
): BridgeTransitRecord {
  return {
    tokenId: "123",
    srcChainId: 11155111,
    dstChainId: 84532,
    recipient: "0xabc",
    guid: "0xguid",
    sentAt: 1_000_000,
    mode: "move",
    phase: "source_confirmed",
    ...overrides,
  };
}

describe("bridgeTransitSessionKey", () => {
  it("lowercases address", () => {
    assert.equal(
      bridgeTransitSessionKey("0xAbC", "1"),
      "kargain:bridge-transit:v1:0xabc:1",
    );
  });
});

describe("parseBridgeTransitRecord", () => {
  it("accepts valid record", () => {
    const parsed = parseBridgeTransitRecord(baseRecord());
    assert.ok(parsed);
    assert.equal(parsed.recipient, "0xabc");
    assert.equal(parsed.mode, "move");
  });

  it("rejects malformed", () => {
    assert.equal(parseBridgeTransitRecord(null), null);
    assert.equal(parseBridgeTransitRecord({ tokenId: "x" }), null);
    assert.equal(
      parseBridgeTransitRecord(baseRecord({ phase: "nope" as never })),
      null,
    );
  });
});

describe("session I/O", () => {
  it("round-trips through injectable storage", () => {
    const store = memoryStorage();
    const record = baseRecord();
    writeBridgeTransitRecord("0xAbC", record, store);
    const read = readBridgeTransitRecord("0xabc", "123", store);
    assert.deepEqual(read, { ...record, recipient: "0xabc" });
    clearBridgeTransitRecord("0xAbC", "123", store);
    assert.equal(readBridgeTransitRecord("0xabc", "123", store), null);
  });
});

describe("reconcileBridgeTransit", () => {
  it("promotes source_confirmed to in_flight when dst not ready", () => {
    const next = reconcileBridgeTransit(baseRecord(), {
      now: 1_000_000 + 5_000,
      dstOwner: null,
      ponderCustodyChain: 11155111,
    });
    assert.equal(next?.phase, "in_flight");
  });

  it("moves to indexer_catchup when dst owner matches", () => {
    const next = reconcileBridgeTransit(
      baseRecord({ phase: "in_flight", recipient: "0xAbC" }),
      {
        now: 1_000_000 + 5_000,
        dstOwner: "0xabc",
        ponderCustodyChain: 11155111,
      },
    );
    assert.equal(next?.phase, "indexer_catchup");
  });

  it("clears when ponder custody equals dst", () => {
    const next = reconcileBridgeTransit(baseRecord({ phase: "indexer_catchup" }), {
      now: 1_000_000 + 5_000,
      dstOwner: "0xabc",
      ponderCustodyChain: 84532,
    });
    assert.equal(next, null);
  });

  it("times out after delivery window", () => {
    const next = reconcileBridgeTransit(baseRecord({ phase: "in_flight" }), {
      now: 1_000_000 + 11 * 60 * 1000,
      dstOwner: null,
      ponderCustodyChain: null,
      deliveryTimeoutMs: 10 * 60 * 1000,
    });
    assert.equal(next?.phase, "timed_out");
  });

  it("clears after hard TTL", () => {
    const next = reconcileBridgeTransit(baseRecord(), {
      now: 1_000_000 + 25 * 60 * 60 * 1000,
      dstOwner: null,
      ponderCustodyChain: null,
      hardTtlMs: 24 * 60 * 60 * 1000,
    });
    assert.equal(next, null);
  });

  it("clears complete and timed_out records", () => {
    assert.equal(
      reconcileBridgeTransit(baseRecord({ phase: "complete" }), {
        now: 1_000_000 + 1,
        dstOwner: null,
        ponderCustodyChain: null,
      }),
      null,
    );
  });
});

describe("isBridgeTransitActivePhase", () => {
  it("marks in-flight phases active", () => {
    assert.equal(isBridgeTransitActivePhase("in_flight"), true);
    assert.equal(isBridgeTransitActivePhase("indexer_catchup"), true);
    assert.equal(isBridgeTransitActivePhase("complete"), false);
    assert.equal(isBridgeTransitActivePhase("timed_out"), false);
  });
});

describe("deriveBridgeTransitUi", () => {
  it("sets step index for in_flight and arrived", () => {
    const mid = deriveBridgeTransitUi(
      baseRecord({ phase: "in_flight" }),
      "Base Sepolia",
    );
    assert.equal(mid.stepIndex, 1);
    assert.equal(mid.active, true);
    assert.match(mid.description, /in transit/i);

    const arrived = deriveBridgeTransitUi(
      baseRecord({ phase: "indexer_catchup" }),
      "Base Sepolia",
    );
    assert.equal(arrived.stepIndex, 2);
  });
});

describe("mergeProfilePassportWithTransit", () => {
  it("returns custody href when no transit", () => {
    const overlay = mergeProfilePassportWithTransit({
      tokenId: "1",
      originChainId: 84532,
      custodyChain: 84532,
      transit: null,
      dstName: "Sepolia",
    });
    assert.equal(overlay.inTransit, false);
    assert.equal(overlay.hrefChainId, 84532);
    assert.equal(overlay.badge, null);
  });

  it("badges In transit and href src while in flight", () => {
    const overlay = mergeProfilePassportWithTransit({
      tokenId: "1",
      originChainId: 11155111,
      custodyChain: 11155111,
      transit: baseRecord({ phase: "in_flight", mode: "move" }),
      dstName: "Base Sepolia",
    });
    assert.equal(overlay.inTransit, true);
    assert.equal(overlay.hrefChainId, 11155111);
    assert.equal(overlay.badge, "In transit to Base Sepolia");
  });

  it("href dst after delivered", () => {
    const overlay = mergeProfilePassportWithTransit({
      tokenId: "1",
      originChainId: 11155111,
      custodyChain: 11155111,
      transit: baseRecord({ phase: "indexer_catchup", mode: "return" }),
      dstName: "Ethereum Sepolia",
    });
    assert.equal(overlay.hrefChainId, 84532);
    assert.equal(overlay.badge, "Returning to Ethereum Sepolia");
  });
});
