import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COMMERCIAL_ACTIVE,
  requireCommercialActive,
  requireSvmCommercialActive,
  type CommercialRegistry,
  type EvmCommercialActiveStack,
} from "../lib/web3/commercial-active.ts";
import { mintKargainNamespace } from "../lib/web3/kargain-namespace.ts";
import { namespaceFromLayerZeroEid } from "../lib/web3/kargain-namespace.ts";
import {
  IRYS_DEVNET_BUNDLER_URL,
  planIrysUpload,
} from "../lib/storage/irys-upload-plan.ts";
import { productSvmRpcUrl } from "../lib/web3/svm-rpc.ts";
import { rpcUrlForChain } from "../lib/web3/supported-chains.ts";
import { FIXTURE_SVM_STACK } from "./fixtures/commercial-svm-stack.ts";

const SOLANA = namespaceFromLayerZeroEid(40168);

/** Frozen EVM plans — П-8 must keep these byte-identical. */
const FROZEN_BASE_SEPOLIA = {
  paymentToken: "base-eth",
  bundlerUrl: IRYS_DEVNET_BUNDLER_URL,
  rpcUrl: "https://sepolia.base.org",
  devnet: true,
} as const;

const FROZEN_ETH_SEPOLIA = {
  paymentToken: "ethereum",
  bundlerUrl: IRYS_DEVNET_BUNDLER_URL,
  rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
  devnet: true,
} as const;

describe("planIrysUpload", () => {
  it("plans Base Sepolia as base-eth + Irys devnet (EVM identity freeze)", () => {
    const result = planIrysUpload(requireCommercialActive(84532));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.plan, FROZEN_BASE_SEPOLIA);
    assert.equal(result.plan.rpcUrl, rpcUrlForChain(84532));
  });

  it("plans Ethereum Sepolia as ethereum + Irys devnet (EVM identity freeze)", () => {
    const result = planIrysUpload(requireCommercialActive(11155111));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.plan, FROZEN_ETH_SEPOLIA);
    assert.equal(result.plan.rpcUrl, rpcUrlForChain(11155111));
  });

  it("unregistered SVM namespace is wrong_vm without throwing", () => {
    const unregistered = {
      ...FIXTURE_SVM_STACK,
      namespace: mintKargainNamespace(2_000_049_999),
    };
    assert.doesNotThrow(() => {
      const result = planIrysUpload(unregistered);
      assert.deepEqual(result, { ok: false, cause: "wrong_vm" });
    });
  });

  /**
   * Live commercial Solana row (S9-B). Port §3.7 / П-8 — inverted in place:
   * ok + paymentToken `"solana"` + `productSvmRpcUrl` (title kept for history).
   */
  it("LIVE commercial Solana row is currently wrong_vm (П-8 must invert to solana)", () => {
    const stack = requireSvmCommercialActive(SOLANA);
    assert.equal(stack.vm, "svm");
    assert.equal(Number(stack.namespace), SOLANA);
    assert.equal("chainId" in stack, false);
    const prev = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL = "https://api.devnet.solana.com";
    try {
      const result = planIrysUpload(stack);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.plan.paymentToken, "solana");
      assert.equal(result.plan.bundlerUrl, IRYS_DEVNET_BUNDLER_URL);
      assert.equal(result.plan.devnet, true);
      assert.equal(result.plan.rpcUrl, productSvmRpcUrl());
      assert.equal(result.plan.rpcUrl, "https://api.devnet.solana.com");
    } finally {
      if (prev === undefined) {
        delete process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
      } else {
        process.env.NEXT_PUBLIC_SOLANA_RPC_URL = prev;
      }
    }
  });

  it("refuses commercial EVM without Irys payment row as unsupported_network", () => {
    const base = COMMERCIAL_ACTIVE[84532]! as EvmCommercialActiveStack;
    const unsupportedNs = 8453;
    const unsupportedStack: EvmCommercialActiveStack = {
      ...base,
      chainId: unsupportedNs,
      namespace: mintKargainNamespace(unsupportedNs),
    };
    const registry: CommercialRegistry = {
      ...COMMERCIAL_ACTIVE,
      [unsupportedNs]: unsupportedStack,
    };
    const result = planIrysUpload(unsupportedStack, registry);
    assert.deepEqual(result, { ok: false, cause: "unsupported_network" });
  });

  it("refuses SVM when product RPC is unset as no_rpc", () => {
    const stack = requireSvmCommercialActive(SOLANA);
    const prev = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
    delete process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
    try {
      const result = planIrysUpload(stack);
      assert.deepEqual(result, { ok: false, cause: "no_rpc" });
    } finally {
      if (prev === undefined) {
        delete process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
      } else {
        process.env.NEXT_PUBLIC_SOLANA_RPC_URL = prev;
      }
    }
  });

  it("vm mismatch with registry is wrong_vm", () => {
    const live = requireSvmCommercialActive(SOLANA);
    const mismatched = {
      ...requireCommercialActive(84532),
      namespace: live.namespace,
    };
    const result = planIrysUpload(mismatched);
    assert.deepEqual(result, { ok: false, cause: "wrong_vm" });
  });
});
