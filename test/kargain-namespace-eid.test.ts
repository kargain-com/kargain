/**
 * LayerZero EID → commercial namespace resolver (S7b).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { commercialNamespaceFromLayerZeroEid } from "../lib/web3/commercial-eid-namespace.ts";

describe("commercialNamespaceFromLayerZeroEid", () => {
  it("40245 → Base Sepolia namespace 84532", () => {
    const result = commercialNamespaceFromLayerZeroEid(40245);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(Number(result.namespace), 84532);
  });

  it("40161 → Ethereum Sepolia namespace 11155111", () => {
    const result = commercialNamespaceFromLayerZeroEid(40161);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(Number(result.namespace), 11155111);
  });

  it("40168 (SVM Devnet EID) refuses without COMMERCIAL_ACTIVE row", () => {
    const result = commercialNamespaceFromLayerZeroEid(40168);
    assert.deepEqual(result, { ok: false, reason: "unknown_endpoint_id" });
  });

  it("unknown EID refuses with named reason", () => {
    const result = commercialNamespaceFromLayerZeroEid(99999);
    assert.deepEqual(result, { ok: false, reason: "unknown_endpoint_id" });
  });

  it("non-positive EID refuses", () => {
    assert.deepEqual(commercialNamespaceFromLayerZeroEid(0), {
      ok: false,
      reason: "unknown_endpoint_id",
    });
    assert.deepEqual(commercialNamespaceFromLayerZeroEid(-1), {
      ok: false,
      reason: "unknown_endpoint_id",
    });
  });
});
