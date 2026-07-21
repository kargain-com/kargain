import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ENFORCED_GAS_SEND,
  ENFORCED_GAS_SEND_AND_COMPOSE,
  LZ_RECEIVE_GAS_CAP,
  LZ_RECEIVE_GAS_MARGIN_BPS,
  LZ_RECEIVE_MEASURED_500_CHAR_GAS,
  requiredLzReceiveGasForByteLength,
  requiredLzReceiveGasForUri,
} from "../lib/web3/bridge/lz-receive-gas";

const TYPICAL_AR =
  "ar://AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("lz-receive-gas floors", () => {
  it("exports pathway floors", () => {
    assert.equal(ENFORCED_GAS_SEND, 100_000);
    assert.equal(ENFORCED_GAS_SEND_AND_COMPOSE, 250_000);
  });
});

describe("requiredLzReceiveGasForUri", () => {
  it("empty / short / typical ar:// → 250k floor", () => {
    for (const uri of ["", "ar://x", TYPICAL_AR]) {
      const r = requiredLzReceiveGasForUri(uri);
      assert.equal(r.ok, true);
      if (r.ok) assert.equal(r.gas, ENFORCED_GAS_SEND_AND_COMPOSE);
    }
  });

  it("500-char URI ≥ measured + margin", () => {
    const uri = `ar://${"b".repeat(500 - 5)}`;
    assert.equal(uri.length, 500);
    const r = requiredLzReceiveGasForUri(uri);
    assert.equal(r.ok, true);
    const min =
      Math.ceil(
        (LZ_RECEIVE_MEASURED_500_CHAR_GAS *
          (10_000 + LZ_RECEIVE_GAS_MARGIN_BPS)) /
          10_000,
      );
    if (r.ok) {
      assert.ok(r.gas >= min, `gas ${r.gas} < min ${min}`);
      assert.ok(r.gas > ENFORCED_GAS_SEND_AND_COMPOSE);
    }
  });

  it("is monotonic in byte length", () => {
    let prev = 0;
    for (const len of [0, 48, 100, 250, 500, 600, 700]) {
      const r = requiredLzReceiveGasForByteLength(len);
      if (!r.ok) break;
      assert.ok(r.gas >= prev, `len ${len}: ${r.gas} < prev ${prev}`);
      prev = r.gas;
    }
  });

  it("fail-closed above cap", () => {
    // Margined model exceeds 1M around ~732 bytes; use a clear overshoot.
    const r = requiredLzReceiveGasForByteLength(2_000);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, "exceeds_cap");
      assert.equal(r.cap, LZ_RECEIVE_GAS_CAP);
      assert.ok(r.required > LZ_RECEIVE_GAS_CAP);
    }
  });

  it("UTF-8 multi-byte counts bytes not code points", () => {
    // One code point, three UTF-8 bytes — same as byteLength 3 ASCII.
    const multi = "€"; // U+20AC → 3 bytes
    assert.equal(new TextEncoder().encode(multi).byteLength, 3);
    assert.deepEqual(
      requiredLzReceiveGasForUri(multi),
      requiredLzReceiveGasForByteLength(3),
    );
  });
});
