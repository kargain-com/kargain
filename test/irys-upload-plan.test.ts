import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  IRYS_DEVNET_BUNDLER_URL,
  isIrysSupportedChain,
  planIrysUpload,
  supportedIrysChainIds,
} from "../lib/storage/irys-upload-plan.ts";
import { rpcUrlForChain } from "../lib/web3/supported-chains.ts";

describe("planIrysUpload", () => {
  it("plans Base Sepolia as base-eth + Irys devnet", () => {
    const plan = planIrysUpload(84532);
    assert.equal(plan.paymentToken, "base-eth");
    assert.equal(plan.bundlerUrl, IRYS_DEVNET_BUNDLER_URL);
    assert.equal(plan.devnet, true);
    assert.equal(plan.rpcUrl, rpcUrlForChain(84532));
  });

  it("plans Ethereum Sepolia as ethereum + Irys devnet", () => {
    const plan = planIrysUpload(11155111);
    assert.equal(plan.paymentToken, "ethereum");
    assert.equal(plan.bundlerUrl, IRYS_DEVNET_BUNDLER_URL);
    assert.equal(plan.devnet, true);
    assert.equal(plan.rpcUrl, rpcUrlForChain(11155111));
  });

  it("fail-closed for unknown and mainnet chains", () => {
    assert.throws(() => planIrysUpload(31337), /Unsupported chain for Irys uploads: 31337/);
    assert.throws(() => planIrysUpload(8453), /Unsupported chain for Irys uploads: 8453/);
    assert.throws(() => planIrysUpload(1), /Unsupported chain for Irys uploads: 1/);
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
