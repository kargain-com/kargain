import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DECLARED_PASSPORT_URI_CEILING_BYTES } from "../lib/web3/declared-uri-ceiling";
import {
  ENFORCED_GAS_SEND,
  ENFORCED_GAS_SEND_AND_COMPOSE,
  LZ_RECEIVE_GAS_CAP,
  LZ_RECEIVE_GAS_MARGIN_BPS,
  LZ_RECEIVE_MEASURED_500_CHAR_GAS,
  requiredLzReceiveGasForByteLength,
  requiredLzReceiveGasForUri,
  requiredNonEvmReceiveBudgetForByteLength,
  requiredReceiveBudgetForDestinationClass,
  type NonEvmReceiveBudgetParams,
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

  it("at declared ceiling: ok and under gas cap", () => {
    const r = requiredLzReceiveGasForByteLength(
      DECLARED_PASSPORT_URI_CEILING_BYTES,
    );
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.gas, 342_669);
      assert.ok(r.gas < LZ_RECEIVE_GAS_CAP);
    }
  });

  it("historical 500-char slope still documents measured margin (pre-ceiling)", () => {
    // Slope anchor only — length is above declared ceiling so the API refuses.
    const min = Math.ceil(
      (LZ_RECEIVE_MEASURED_500_CHAR_GAS *
        (10_000 + LZ_RECEIVE_GAS_MARGIN_BPS)) /
        10_000,
    );
    assert.ok(min > ENFORCED_GAS_SEND_AND_COMPOSE);
    const r = requiredLzReceiveGasForByteLength(500);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "exceeds_uri_ceiling");
  });

  it("is monotonic in byte length up to the ceiling", () => {
    let prev = 0;
    for (const len of [0, 48, 100, DECLARED_PASSPORT_URI_CEILING_BYTES]) {
      const r = requiredLzReceiveGasForByteLength(len);
      assert.equal(r.ok, true);
      if (r.ok) {
        assert.ok(r.gas >= prev, `len ${len}: ${r.gas} < prev ${prev}`);
        prev = r.gas;
      }
    }
  });

  it("fail-closed above declared URI ceiling", () => {
    const r = requiredLzReceiveGasForByteLength(
      DECLARED_PASSPORT_URI_CEILING_BYTES + 1,
    );
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, "exceeds_uri_ceiling");
      assert.equal(r.max, DECLARED_PASSPORT_URI_CEILING_BYTES);
      assert.equal(r.length, DECLARED_PASSPORT_URI_CEILING_BYTES + 1);
    }
  });

  it("UTF-8 multi-byte counts bytes not code points", () => {
    const multi = "€"; // U+20AC → 3 bytes
    assert.equal(new TextEncoder().encode(multi).byteLength, 3);
    assert.deepEqual(
      requiredLzReceiveGasForUri(multi),
      requiredLzReceiveGasForByteLength(3),
    );
  });
});

const INJECTED_NON_EVM: NonEvmReceiveBudgetParams = {
  computeBase: 10,
  computePerUriByte: 2,
  computeMarginBps: 1_000,
  computeFloor: 20,
  computeCap: 100,
  rentBase: 5,
  rentPerUriByte: 1,
  rentCap: 50,
};

describe("non-EVM receive budget (injected params)", () => {
  it("computes compute + rent from URI byte length", () => {
    const r = requiredNonEvmReceiveBudgetForByteLength(4, INJECTED_NON_EVM);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.compute, 20);
      assert.equal(r.rent, 9);
    }
  });

  it("refuses when compute exceeds cap (does not truncate)", () => {
    const r = requiredNonEvmReceiveBudgetForByteLength(80, INJECTED_NON_EVM);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, "exceeds_cap");
      assert.equal(r.dimension, "compute");
      assert.ok(r.required > r.cap);
    }
  });

  it("refuses when rent exceeds cap (does not truncate)", () => {
    const params = { ...INJECTED_NON_EVM, computeCap: 10_000, rentCap: 8 };
    const r = requiredNonEvmReceiveBudgetForByteLength(4, params);
    assert.equal(r.ok, false);
    if (!r.ok && r.reason === "exceeds_cap") {
      assert.equal(r.dimension, "rent");
      assert.equal(r.cap, 8);
      assert.ok(r.required > 8);
    }
  });

  it("refuses above declared URI ceiling before caps", () => {
    const r = requiredNonEvmReceiveBudgetForByteLength(
      DECLARED_PASSPORT_URI_CEILING_BYTES + 1,
      { ...INJECTED_NON_EVM, computeCap: 10_000_000, rentCap: 10_000_000 },
    );
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "exceeds_uri_ceiling");
  });

  it("dispatcher takes destination class, not an EID; EVM path unchanged", () => {
    const uri = TYPICAL_AR;
    assert.deepEqual(
      requiredReceiveBudgetForDestinationClass("evm", uri),
      requiredLzReceiveGasForUri(uri),
    );
    assert.throws(
      () => requiredReceiveBudgetForDestinationClass("non-evm", uri),
      /injected compute\/rent parameters/,
    );
    const r = requiredReceiveBudgetForDestinationClass(
      "non-evm",
      "ab",
      INJECTED_NON_EVM,
    );
    assert.equal(r.ok, true);
  });
});
