import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COMMERCIAL_ACTIVE,
  requireCommercialActive,
  requireSvmCommercialActive,
} from "../lib/web3/commercial-active.ts";
import { namespaceFromLayerZeroEid } from "../lib/web3/kargain-namespace.ts";
import {
  IRYS_DEVNET_BUNDLER_URL,
  isIrysSupportedChain,
  planIrysUpload,
  supportedIrysChainIds,
} from "../lib/storage/irys-upload-plan.ts";
import { rpcUrlForChain } from "../lib/web3/supported-chains.ts";
import { FIXTURE_SVM_STACK } from "./fixtures/commercial-svm-stack.ts";

const SOLANA = namespaceFromLayerZeroEid(40168);

describe("planIrysUpload", () => {
  it("plans Base Sepolia as base-eth + Irys devnet", () => {
    const result = planIrysUpload(requireCommercialActive(84532));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.plan.paymentToken, "base-eth");
    assert.equal(result.plan.bundlerUrl, IRYS_DEVNET_BUNDLER_URL);
    assert.equal(result.plan.devnet, true);
    assert.equal(result.plan.rpcUrl, rpcUrlForChain(84532));
  });

  it("plans Ethereum Sepolia as ethereum + Irys devnet", () => {
    const result = planIrysUpload(requireCommercialActive(11155111));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.plan.paymentToken, "ethereum");
    assert.equal(result.plan.bundlerUrl, IRYS_DEVNET_BUNDLER_URL);
    assert.equal(result.plan.devnet, true);
    assert.equal(result.plan.rpcUrl, rpcUrlForChain(11155111));
  });

  it("fixture SVM stack is refused as wrong_vm without throwing (stale gate until П-8)", () => {
    assert.doesNotThrow(() => {
      const result = planIrysUpload(FIXTURE_SVM_STACK);
      assert.deepEqual(result, { ok: false, cause: "wrong_vm" });
    });
  });

  /**
   * Live commercial Solana row (S9-B). Port §3.7 / П-8 require `"solana"` here.
   * Today the planner still hard-refuses — measured pin of the open defect.
   * П-8 must invert this case to ok + paymentToken "solana" in the same unit
   * (do not leave this green pin after the planner is fixed).
   */
  it("LIVE commercial Solana row is currently wrong_vm (П-8 must invert to solana)", () => {
    const stack = requireSvmCommercialActive(SOLANA);
    assert.equal(stack.vm, "svm");
    assert.equal(Number(stack.namespace), SOLANA);
    assert.equal("chainId" in stack, false);
    const result = planIrysUpload(stack);
    assert.deepEqual(result, { ok: false, cause: "wrong_vm" });
  });

  it("refuses EVM without payment row as unsupported_network", () => {
    // Synthesize an EVM-shaped stack that is not in the Irys allowlist.
    const base = COMMERCIAL_ACTIVE[84532]!;
    const unsupported = { ...base, chainId: 8453 as const };
    const result = planIrysUpload(unsupported);
    assert.deepEqual(result, { ok: false, cause: "unsupported_network" });
  });

  it("exposes allowlist helpers from the same registry", () => {
    assert.equal(isIrysSupportedChain(84532), true);
    assert.equal(isIrysSupportedChain(11155111), true);
    assert.equal(isIrysSupportedChain(8453), false);
    assert.equal(isIrysSupportedChain(1), false);
    assert.deepEqual([...supportedIrysChainIds()].sort((a, b) => a - b), [
      84532, 11155111,
    ]);
  });
});
