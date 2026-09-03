import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  chainSelectorSwitchTargets,
  deriveChainSelectorState,
  deriveChainSelectorWrong,
  isKargainWriteChain,
} from "../lib/web3/chain-selector-state.ts";
import { mintKargainNamespace } from "../lib/web3/kargain-namespace.ts";

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

describe("deriveChainSelectorState", () => {
  it("SVM session is wrong_vm", () => {
    assert.equal(
      deriveChainSelectorState({
        account: {
          status: "connected",
          vm: "svm",
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        },
        expectedChainId: 84532,
      }),
      "wrong_vm",
    );
  });

  it("matching EVM is ok", () => {
    assert.equal(
      deriveChainSelectorState({
        account: {
          status: "connected",
          vm: "evm",
          address: "0x0000000000000000000000000000000000000001",
          namespace: mintKargainNamespace(84532),
          chainId: 84532,
        },
        expectedChainId: 84532,
      }),
      "ok",
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

  it("wrong_vm has no switch targets", () => {
    assert.deepEqual(chainSelectorSwitchTargets(84532, "wrong_vm"), []);
  });
});
