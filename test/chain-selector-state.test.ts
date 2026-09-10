/**
 * Commercial-namespace chain selector (pre-§7.2).
 * Symmetric wrong_vm; SVM sessions can be ok; picker ≡ registry; EVM switch only.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mintKargainNamespace } from "../lib/web3/kargain-namespace.ts";
import {
  type ActiveAccount,
} from "../lib/web3/active-account.ts";
import {
  chainSelectorMaySwitchChain,
  chainSelectorStateCopy,
  chainSelectorSwitchTargets,
  commercialNetworkLabel,
  commercialPickerEntries,
  deriveChainSelectorState,
  isKargainWriteChain,
} from "../lib/web3/chain-selector-state.ts";
import {
  COMMERCIAL_ACTIVE,
  type CommercialRegistry,
  registeredCommercialNamespaceIds,
} from "../lib/web3/commercial-active.ts";
import { FIXTURE_SVM_STACK } from "./fixtures/commercial-svm-stack.ts";

const EVM_BASE: ActiveAccount = {
  status: "connected",
  vm: "evm",
  address: "0x0000000000000000000000000000000000000001",
  namespace: mintKargainNamespace(84532),
  chainId: 84532,
};

const EVM_ETH: ActiveAccount = {
  ...EVM_BASE,
  chainId: 11155111,
  namespace: mintKargainNamespace(11155111),
};

const SVM: ActiveAccount = {
  status: "connected",
  vm: "svm",
  address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
};

const SVM_NS = Number(
  commercialNamespaceOfLiveSvm(),
);

function commercialNamespaceOfLiveSvm(): number {
  const ids = registeredCommercialNamespaceIds().filter(
    (id) => COMMERCIAL_ACTIVE[id]?.vm === "svm",
  );
  assert.equal(ids.length, 1, "live registry must have exactly one SVM row");
  return ids[0]!;
}

describe("isKargainWriteChain", () => {
  it("accepts Base Sepolia and Ethereum Sepolia", () => {
    assert.equal(isKargainWriteChain(84532), true);
    assert.equal(isKargainWriteChain(11155111), true);
  });

  it("rejects mainnet, unknown, and SVM namespace", () => {
    assert.equal(isKargainWriteChain(1), false);
    assert.equal(isKargainWriteChain(999), false);
    assert.equal(isKargainWriteChain(SVM_NS), false);
  });
});

describe("deriveChainSelectorState (commercial namespace)", () => {
  it("disconnected → ok", () => {
    assert.equal(
      deriveChainSelectorState({
        account: { status: "disconnected" },
        expectedNamespace: 84532,
      }),
      "ok",
    );
  });

  it("SVM session + expected SVM ns → ok", () => {
    assert.equal(
      deriveChainSelectorState({
        account: SVM,
        expectedNamespace: SVM_NS,
      }),
      "ok",
    );
  });

  it("SVM session without expected → ok", () => {
    assert.equal(deriveChainSelectorState({ account: SVM }), "ok");
  });

  it("EVM session + expected SVM ns → wrong_vm with Solana family copy", () => {
    assert.equal(
      deriveChainSelectorState({
        account: EVM_BASE,
        expectedNamespace: SVM_NS,
      }),
      "wrong_vm",
    );
    assert.equal(
      chainSelectorStateCopy("wrong_vm", SVM_NS),
      "Connect a Solana wallet to act on this network",
    );
  });

  it("SVM session + expected EVM ns → wrong_vm with Ethereum family copy", () => {
    assert.equal(
      deriveChainSelectorState({
        account: SVM,
        expectedNamespace: 84532,
      }),
      "wrong_vm",
    );
    assert.equal(
      chainSelectorStateCopy("wrong_vm", 84532),
      "Connect an Ethereum wallet to act on this network",
    );
  });

  it("same helper both wrong_vm directions", () => {
    const toSvm = chainSelectorStateCopy("wrong_vm", SVM_NS);
    const toEvm = chainSelectorStateCopy("wrong_vm", 84532);
    assert.match(toSvm ?? "", /Solana/);
    assert.match(toEvm ?? "", /Ethereum/);
    assert.notEqual(toSvm, toEvm);
  });

  it("EVM wrong network stays wrong_network", () => {
    assert.equal(
      deriveChainSelectorState({
        account: EVM_ETH,
        expectedNamespace: 84532,
      }),
      "wrong_network",
    );
  });

  it("matching EVM is ok", () => {
    assert.equal(
      deriveChainSelectorState({
        account: EVM_BASE,
        expectedNamespace: 84532,
      }),
      "ok",
    );
  });
});

describe("commercial picker ≡ registry", () => {
  it("picker list matches registeredCommercialNamespaceIds", () => {
    const entries = commercialPickerEntries();
    assert.deepEqual(
      entries.map((e) => e.namespace),
      [...registeredCommercialNamespaceIds()],
    );
  });

  it("planted stack appears without picker edit", () => {
    const plantedNs = 2_000_049_997;
    const registry: CommercialRegistry = {
      ...COMMERCIAL_ACTIVE,
      [plantedNs]: {
        ...FIXTURE_SVM_STACK,
        namespace: mintKargainNamespace(plantedNs),
      },
    };
    const entries = commercialPickerEntries(registry);
    assert.ok(entries.some((e) => e.namespace === plantedNs));
    assert.equal(
      commercialNetworkLabel(plantedNs, registry),
      "SOL network",
    );
  });
});

describe("chainSelectorSwitchTargets + maySwitch", () => {
  it("returns only expected when it is a write-union chain", () => {
    assert.deepEqual(chainSelectorSwitchTargets(11155111), [11155111]);
  });

  it("lists write-union when expected absent", () => {
    const targets = chainSelectorSwitchTargets(null);
    assert.ok(targets.includes(84532));
    assert.ok(targets.includes(11155111));
    assert.ok(!targets.includes(SVM_NS));
  });

  it("wrong_vm has no switch targets", () => {
    assert.deepEqual(chainSelectorSwitchTargets(84532, "wrong_vm"), []);
  });

  it("cross-family pick must not invoke switchChain (maySwitch false)", () => {
    assert.equal(chainSelectorMaySwitchChain(EVM_BASE, SVM_NS), false);
    assert.equal(chainSelectorMaySwitchChain(SVM, 84532), false);
    assert.equal(chainSelectorMaySwitchChain(EVM_BASE, 11155111), true);
  });
});
