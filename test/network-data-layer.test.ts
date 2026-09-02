/**
 * S8-1 network-class data owners — explorer, icon, native unit, FX/storage.
 * Proved against live EVM stacks + tests-only SVM fixture.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COMMERCIAL_ACTIVE,
  COMMERCIAL_VMS,
  nativeUnitOf,
  requireCommercialActive,
} from "../lib/web3/commercial-active.ts";
import {
  FX_RATE_CHAIN_ID,
  fxRateChainIdFor,
  STORAGE_ENV_CHAIN_ID,
  storageEnvChainIdFor,
} from "../lib/web3/chain-context.ts";
import { networkIconUrl } from "../lib/web3/chain-icon-url.ts";
import {
  explorerAddressUrl,
  explorerTxUrl,
} from "../lib/web3/network-explorer.ts";
import {
  FIXTURE_SVM_ICON_URL,
  FIXTURE_SVM_STACK,
} from "./fixtures/commercial-svm-stack.ts";

describe("network data layer (S8-1)", () => {
  it("COMMERCIAL_VMS enumerates both discriminants", () => {
    assert.deepEqual([...COMMERCIAL_VMS], ["evm", "svm"]);
  });

  it("live EVM stacks carry explorer bases — no invent at call site", () => {
    const hub = requireCommercialActive(84532);
    const eth = requireCommercialActive(11155111);
    assert.equal(hub.explorerBaseUrl, "https://sepolia.basescan.org");
    assert.equal(eth.explorerBaseUrl, "https://sepolia.etherscan.io");
    assert.ok(
      explorerAddressUrl(hub, "0x0000000000000000000000000000000000000001").startsWith(
        "https://sepolia.basescan.org/address/",
      ),
    );
    assert.equal(
      explorerTxUrl(eth, "0xabc"),
      "https://sepolia.etherscan.io/tx/0xabc",
    );
  });

  it("fixture SVM explorer + native unit answer from the stack", () => {
    assert.equal(FIXTURE_SVM_STACK.vm, "svm");
    assert.deepEqual(nativeUnitOf(FIXTURE_SVM_STACK), {
      symbol: "SOL",
      decimals: 9,
    });
    assert.equal(
      explorerTxUrl(FIXTURE_SVM_STACK, "5SigExample"),
      "https://explorer.solana.com/tx/5SigExample",
    );
  });

  it("product icon map has Base; Eth Sepolia and fixture SVM have none", () => {
    const hub = requireCommercialActive(84532);
    const eth = requireCommercialActive(11155111);
    assert.ok(networkIconUrl(hub)?.includes("/base/"));
    assert.equal(networkIconUrl(eth), undefined);
    assert.equal(networkIconUrl(FIXTURE_SVM_STACK), undefined);
    // Fixture icon constant is tests-only — not registered in product map.
    assert.ok(FIXTURE_SVM_ICON_URL.includes("solana"));
  });

  it("FX and storage pins refuse non-EVM by name", () => {
    assert.equal(
      fxRateChainIdFor(requireCommercialActive(FX_RATE_CHAIN_ID)),
      84532,
    );
    assert.equal(
      storageEnvChainIdFor(requireCommercialActive(STORAGE_ENV_CHAIN_ID)),
      84532,
    );
    assert.throws(
      () => fxRateChainIdFor(FIXTURE_SVM_STACK),
      /has no FX env pin \(vm=svm\)/,
    );
    assert.throws(
      () => storageEnvChainIdFor(FIXTURE_SVM_STACK),
      /has no storage env pin \(vm=svm\)/,
    );
  });

  it("live registry still has no Solana row", () => {
    for (const stack of Object.values(COMMERCIAL_ACTIVE)) {
      assert.equal(stack.vm, "evm");
      assert.ok(stack.explorerBaseUrl.length > 0);
    }
  });
});
