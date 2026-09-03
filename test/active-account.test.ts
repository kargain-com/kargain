/**
 * S8-2-fix active-account owners + SVM unresolved namespace + wrong_vm state.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  commercialNamespaceOf,
  connectedAddress,
  evmSwitchChainAvailability,
  isAccountConnected,
  requireEvmSession,
  type ActiveAccount,
} from "../lib/web3/active-account.ts";
import {
  fxRateChainIdFor,
  storageEnvChainIdFor,
} from "../lib/web3/chain-context.ts";
import {
  chainSelectorSwitchTargets,
  deriveChainSelectorState,
} from "../lib/web3/chain-selector-state.ts";
import { mintKargainNamespace } from "../lib/web3/kargain-namespace.ts";
import {
  FIXTURE_SVM_STACK,
} from "./fixtures/commercial-svm-stack.ts";

const EVM: ActiveAccount = {
  status: "connected",
  vm: "evm",
  address: "0x0000000000000000000000000000000000000001",
  namespace: mintKargainNamespace(84532),
  chainId: 84532,
};

const SVM: ActiveAccount = {
  status: "connected",
  vm: "svm",
  address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
};

describe("active-account owners (S8-2-fix)", () => {
  it("requireEvmSession answers for EVM and refuses SVM / disconnected by name", () => {
    assert.deepEqual(requireEvmSession(EVM), {
      ok: true,
      address: EVM.address,
      chainId: 84532,
      namespace: EVM.namespace,
    });
    assert.deepEqual(requireEvmSession(SVM), {
      ok: false,
      cause: "wrong_vm",
    });
    assert.deepEqual(requireEvmSession({ status: "disconnected" }), {
      ok: false,
      cause: "disconnected",
    });
  });

  it("commercialNamespaceOf refuses SVM with unresolved_namespace (no invented id)", () => {
    assert.deepEqual(commercialNamespaceOf(EVM), {
      ok: true,
      namespace: EVM.namespace,
    });
    assert.deepEqual(commercialNamespaceOf(SVM), {
      ok: false,
      cause: "unresolved_namespace",
    });
    assert.deepEqual(commercialNamespaceOf({ status: "disconnected" }), {
      ok: false,
      cause: "disconnected",
    });
  });

  it("evmSwitchChainAvailability mirrors requireEvmSession causes", () => {
    assert.deepEqual(evmSwitchChainAvailability(EVM), { available: true });
    assert.deepEqual(evmSwitchChainAvailability(SVM), {
      available: false,
      cause: "wrong_vm",
    });
    assert.deepEqual(evmSwitchChainAvailability({ status: "disconnected" }), {
      available: false,
      cause: "disconnected",
    });
  });

  it("family-agnostic projections remain", () => {
    assert.equal(connectedAddress(EVM), EVM.address);
    assert.equal(connectedAddress(SVM), SVM.address);
    assert.equal(isAccountConnected(EVM), true);
    assert.equal(isAccountConnected(SVM), true);
    assert.equal(isAccountConnected({ status: "disconnected" }), false);
  });

  it("SVM fixture stack — FX and storage refuse by name", () => {
    assert.throws(
      () => fxRateChainIdFor(FIXTURE_SVM_STACK),
      /has no FX env pin \(vm=svm\)/,
    );
    assert.throws(
      () => storageEnvChainIdFor(FIXTURE_SVM_STACK),
      /has no storage env pin \(vm=svm\)/,
    );
  });
});

describe("chain-selector wrong_vm (S8-2-fix)", () => {
  it("SVM connected (no namespace) → wrong_vm with empty switch targets", () => {
    assert.equal(
      deriveChainSelectorState({ account: SVM, expectedChainId: 84532 }),
      "wrong_vm",
    );
    assert.deepEqual(chainSelectorSwitchTargets(84532, "wrong_vm"), []);
  });

  it("EVM wrong network stays wrong_network", () => {
    const eth: ActiveAccount = {
      ...EVM,
      chainId: 11155111,
      namespace: mintKargainNamespace(11155111),
    };
    assert.equal(
      deriveChainSelectorState({ account: eth, expectedChainId: 84532 }),
      "wrong_network",
    );
  });

  it("disconnected → ok", () => {
    assert.equal(
      deriveChainSelectorState({
        account: { status: "disconnected" },
        expectedChainId: 84532,
      }),
      "ok",
    );
  });
});
