/**
 * S4a T3 / S9-B final — SVM commercial stack shape + live reserved namespace row.
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

  it("live registry now includes the Solana reserved namespace row", () => {
    const stack = commercialActive(SOLANA_DEVNET_NAMESPACE);
    assert.ok(stack);
    assert.equal(stack?.vm, "svm");
    assert.equal(isCommercialEip155Id(SOLANA_DEVNET_NAMESPACE), false);
    assert.equal(isCommercialNamespace(SOLANA_DEVNET_NAMESPACE), true);
    assert.ok(SOLANA_DEVNET_NAMESPACE in COMMERCIAL_ACTIVE);
  });

  it("reserved namespace resolves to the live SVM stack", () => {
    const stack = requireCommercialActive(SOLANA_DEVNET_NAMESPACE);
    assert.equal(stack.vm, "svm");
    assert.equal(Number(stack.namespace), SOLANA_DEVNET_NAMESPACE);
    assert.equal("indexFromBlock" in stack, false);
  });

  it("unknown non-reserved chain keeps the generic missing message", () => {
    assert.throws(
      () => requireCommercialActive(1),
      /No COMMERCIAL_ACTIVE entry for chain 1/,
    );
  });
});
