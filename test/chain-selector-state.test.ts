import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  chainSelectorSwitchTargets,
  deriveChainSelectorWrong,
  isKargainWriteChain,
} from "../lib/web3/chain-selector-state.ts";

describe("isKargainWriteChain", () => {
  it("accepts Base Sepolia and Ethereum Sepolia", () => {
    assert.equal(isKargainWriteChain(84532), true);
    assert.equal(isKargainWriteChain(11155111), true);
  });

  it("rejects mainnet and unknown", () => {
    assert.equal(isKargainWriteChain(1), false);
    assert.equal(isKargainWriteChain(999), false);
  });
});

describe("deriveChainSelectorWrong", () => {
  it("is false when disconnected", () => {
    assert.equal(
      deriveChainSelectorWrong({
        isConnected: false,
        walletChainId: 1,
        expectedChainId: 84532,
      }),
      false,
    );
  });

  it("Eth wallet + no expected → not wrong", () => {
    assert.equal(
      deriveChainSelectorWrong({
        isConnected: true,
        walletChainId: 11155111,
        expectedChainId: null,
      }),
      false,
    );
  });

  it("Eth wallet + expected Base → wrong", () => {
    assert.equal(
      deriveChainSelectorWrong({
        isConnected: true,
        walletChainId: 11155111,
        expectedChainId: 84532,
      }),
      true,
    );
  });

  it("Base wallet + expected Eth → wrong", () => {
    assert.equal(
      deriveChainSelectorWrong({
        isConnected: true,
        walletChainId: 84532,
        expectedChainId: 11155111,
      }),
      true,
    );
  });

  it("matching expected → not wrong", () => {
    assert.equal(
      deriveChainSelectorWrong({
        isConnected: true,
        walletChainId: 11155111,
        expectedChainId: 11155111,
      }),
      false,
    );
  });

  it("unsupported wallet → wrong", () => {
    assert.equal(
      deriveChainSelectorWrong({
        isConnected: true,
        walletChainId: 1,
        expectedChainId: null,
      }),
      true,
    );
  });
});

describe("chainSelectorSwitchTargets", () => {
  it("returns only expected when it is a write-union chain", () => {
    assert.deepEqual(chainSelectorSwitchTargets(11155111), [11155111]);
  });

  it("lists write-union when expected absent", () => {
    const targets = chainSelectorSwitchTargets(null);
    assert.ok(targets.includes(84532));
    assert.ok(targets.includes(11155111));
  });
});
