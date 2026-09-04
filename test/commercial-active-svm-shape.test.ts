/**
 * S4a T3 — SVM commercial stack shape + fail-closed reserved namespace.
 * No live Solana row in COMMERCIAL_ACTIVE.
 * S8-1: shape probe lives in test/fixtures/commercial-svm-stack.ts.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COMMERCIAL_ACTIVE,
  commercialActive,
  isCommercialEip155Id,
  isCommercialNamespace,
  requireCommercialActive,
  type CommercialActiveStack,
} from "../lib/web3/commercial-active.ts";
import { namespaceFromLayerZeroEid } from "../lib/web3/kargain-namespace.ts";
import { normalizeProtocolAddressForVm } from "../lib/web3/protocol-address.ts";
import {
  FIXTURE_SVM_NAMESPACE,
  FIXTURE_SVM_STACK,
} from "./fixtures/commercial-svm-stack.ts";

const SOLANA_DEVNET_NAMESPACE = namespaceFromLayerZeroEid(40168);

// Compile-time: SVM arm is a CommercialActiveStack member.
const _unionProbe: CommercialActiveStack = FIXTURE_SVM_STACK;
void _unionProbe;

describe("commercial-active SVM shape (S4a T3)", () => {
  it("fixture SVM shape satisfies CommercialActiveStack and normalizes base58", () => {
    assert.equal(FIXTURE_SVM_STACK.vm, "svm");
    assert.equal(Number(FIXTURE_SVM_STACK.namespace), SOLANA_DEVNET_NAMESPACE);
    assert.equal(Number(FIXTURE_SVM_NAMESPACE), SOLANA_DEVNET_NAMESPACE);
    assert.ok(FIXTURE_SVM_STACK.explorerBaseUrl.length > 0);
    assert.equal(
      normalizeProtocolAddressForVm("svm", FIXTURE_SVM_STACK.layerZeroEndpoint),
      FIXTURE_SVM_STACK.layerZeroEndpoint,
    );
  });

  it("live registry stays EVM-only — no Solana row", () => {
    assert.equal(commercialActive(SOLANA_DEVNET_NAMESPACE), undefined);
    assert.equal(isCommercialEip155Id(SOLANA_DEVNET_NAMESPACE), false);
    assert.equal(isCommercialNamespace(SOLANA_DEVNET_NAMESPACE), false);
    assert.ok(!(SOLANA_DEVNET_NAMESPACE in COMMERCIAL_ACTIVE));
    for (const stack of Object.values(COMMERCIAL_ACTIVE)) {
      assert.equal(stack.vm, "evm");
    }
  });

  it("reserved namespace without a row fails closed by name", () => {
    assert.throws(
      () => requireCommercialActive(SOLANA_DEVNET_NAMESPACE),
      /no SVM row for reserved namespace 2000040168/,
    );
  });

  it("unknown non-reserved chain keeps the generic missing message", () => {
    assert.throws(
      () => requireCommercialActive(1),
      /No COMMERCIAL_ACTIVE entry for chain 1/,
    );
  });
});
