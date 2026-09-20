/**
 * S8-2-fix active-account owners + SVM unresolved namespace + wrong_vm state.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  commercialNamespaceOf,
  connectedAddress,
  decideObservedFamilyConflict,
  decideSvmAccountChangeEvent,
  applySvmSessionChangeDecision,
  dispatchConnect,
  evmSwitchChainAvailability,
  isAccountConnected,
  requireEvmSession,
  svmActiveAccountFromAddress,
  type ActiveAccount,
  type ConnectDispatchPorts,
} from "../lib/web3/active-account.ts";
import {
  fxRateChainIdFor,
  storageEnvChainIdFor,
} from "../lib/web3/chain-context.ts";
import {
  chainSelectorSwitchTargets,
  deriveChainSelectorState,
} from "../lib/web3/chain-selector-state.ts";
import {
  COMMERCIAL_ACTIVE,
  type CommercialRegistry,
} from "../lib/web3/commercial-active.ts";
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

  it("commercialNamespaceOf resolves sole commercial SVM namespace", () => {
    assert.deepEqual(commercialNamespaceOf(EVM), {
      ok: true,
      namespace: EVM.namespace,
    });
    const svmNs = commercialNamespaceOf(SVM);
    assert.equal(svmNs.ok, true);
    if (!svmNs.ok) return;
    assert.equal(Number(svmNs.namespace), Number(FIXTURE_SVM_STACK.namespace));
    assert.deepEqual(commercialNamespaceOf({ status: "disconnected" }), {
      ok: false,
      cause: "disconnected",
    });
  });

  it("commercialNamespaceOf refuses SVM when registry has zero or multiple SVM rows", () => {
    assert.deepEqual(commercialNamespaceOf(SVM, {}), {
      ok: false,
      cause: "unresolved_namespace",
    });
    const multi: CommercialRegistry = {
      84532: COMMERCIAL_ACTIVE[84532]!,
      [Number(FIXTURE_SVM_STACK.namespace)]: FIXTURE_SVM_STACK,
      2_000_049_998: {
        ...FIXTURE_SVM_STACK,
        namespace: mintKargainNamespace(2_000_049_998),
      },
    };
    assert.deepEqual(commercialNamespaceOf(SVM, multi), {
      ok: false,
      cause: "unresolved_namespace",
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

describe("active-account session decisions (S8-D)", () => {
  it("SVM live + EVM appears → disconnect_evm", () => {
    assert.deepEqual(
      decideObservedFamilyConflict({
        svmLive: true,
        evmConnected: true,
        disconnectPending: false,
      }),
      { action: "disconnect_evm" },
    );
    assert.deepEqual(
      decideObservedFamilyConflict({
        svmLive: true,
        evmConnected: false,
        disconnectPending: false,
      }),
      { action: "noop" },
    );
    assert.deepEqual(
      decideObservedFamilyConflict({
        svmLive: false,
        evmConnected: true,
        disconnectPending: false,
      }),
      { action: "noop" },
    );
  });

  it("disconnectPending suppresses a second disconnect_evm", () => {
    assert.deepEqual(
      decideObservedFamilyConflict({
        svmLive: true,
        evmConnected: true,
        disconnectPending: true,
      }),
      { action: "noop" },
    );
  });

  it("EVM live + explicit SVM connect via dispatchConnect → SVM wins", async () => {
    const order: string[] = [];
    const ports: ConnectDispatchPorts = {
      clearSvm: () => {
        order.push("clearSvm");
      },
      onEvmConnect: async () => {
        order.push("evmConnect");
      },
      onEvmDisconnect: async () => {
        order.push("evmDisconnect");
      },
      onSvmConnect: async (walletName) => {
        order.push(`svmConnect:${walletName}`);
      },
      evmConnected: true,
    };
    await dispatchConnect({ family: "svm", walletName: "Phantom" }, ports);
    assert.deepEqual(order, ["evmDisconnect", "svmConnect:Phantom"]);
  });

  it("change event with new account → set_address", () => {
    const next = "So11111111111111111111111111111111111111112";
    assert.deepEqual(
      decideSvmAccountChangeEvent({
        currentAddress: SVM.address,
        accounts: [{ address: next }],
      }),
      { action: "set_address", address: next },
    );
  });

  it("change event with no accounts → clear_session", () => {
    assert.deepEqual(
      decideSvmAccountChangeEvent({
        currentAddress: SVM.address,
        accounts: [],
      }),
      { action: "clear_session" },
    );
  });

  it("change event with non-canonical address → refuse_noncanonical, session unchanged", () => {
    assert.deepEqual(
      decideSvmAccountChangeEvent({
        currentAddress: SVM.address,
        accounts: [{ address: "not-a-solana-address" }],
      }),
      { action: "refuse_noncanonical" },
    );
  });

  it("change event with same canonical address → noop", () => {
    assert.deepEqual(
      decideSvmAccountChangeEvent({
        currentAddress: SVM.address,
        accounts: [{ address: SVM.address }],
      }),
      { action: "noop" },
    );
  });
});

describe("active-account SVM identity (S8-D referential)", () => {
  it("noop / refuse_noncanonical preserve the session object reference", () => {
    const account = svmActiveAccountFromAddress(SVM.address);
    const prev = {
      walletName: "Phantom",
      account,
    };
    const noop = applySvmSessionChangeDecision(prev, { action: "noop" });
    assert.equal(noop, prev);
    assert.equal(noop!.account, account);
    const refused = applySvmSessionChangeDecision(prev, {
      action: "refuse_noncanonical",
    });
    assert.equal(refused, prev);
    assert.equal(refused!.account, account);
  });

  it("set_address yields a new account object; clear yields null", () => {
    const account = svmActiveAccountFromAddress(SVM.address);
    const prev = {
      walletName: "Phantom",
      account,
    };
    const nextAddr = "So11111111111111111111111111111111111111112";
    const updated = applySvmSessionChangeDecision(prev, {
      action: "set_address",
      address: nextAddr,
    });
    assert.notEqual(updated, prev);
    assert.notEqual(updated!.account, account);
    assert.equal(updated!.account.address, nextAddr);
    assert.equal(updated!.account.vm, "svm");
    assert.equal(
      applySvmSessionChangeDecision(prev, { action: "clear_session" }),
      null,
    );
  });

  it("apply on state without top-level address — noop keeps ref; set_address uses account.address", () => {
    const account = svmActiveAccountFromAddress(SVM.address);
    const prev = { walletName: "Phantom", account };
    assert.equal(
      "address" in prev,
      false,
      "session fixture must not carry a parallel address field",
    );
    assert.equal(applySvmSessionChangeDecision(prev, { action: "noop" }), prev);
    const nextAddr = "So11111111111111111111111111111111111111112";
    const updated = applySvmSessionChangeDecision(prev, {
      action: "set_address",
      address: nextAddr,
    });
    assert.equal(updated!.account.address, nextAddr);
    assert.equal("address" in (updated as object), false);
  });

  it("svmActiveAccountFromAddress is the sole SVM account constructor shape", () => {
    const a = svmActiveAccountFromAddress(SVM.address);
    const b = svmActiveAccountFromAddress(SVM.address);
    assert.notEqual(a, b, "each construction allocates once — store the result");
    assert.deepEqual(a, {
      status: "connected",
      vm: "svm",
      address: SVM.address,
    });
  });
});

describe("chain-selector commercial namespace (pre-§7.2)", () => {
  it("SVM + expected EVM → wrong_vm with empty switch targets", () => {
    assert.equal(
      deriveChainSelectorState({ account: SVM, expectedNamespace: 84532 }),
      "wrong_vm",
    );
    assert.deepEqual(chainSelectorSwitchTargets(84532, "wrong_vm"), []);
  });

  it("SVM + expected SVM → ok", () => {
    const ns = commercialNamespaceOf(SVM);
    assert.equal(ns.ok, true);
    if (!ns.ok) return;
    assert.equal(
      deriveChainSelectorState({
        account: SVM,
        expectedNamespace: Number(ns.namespace),
      }),
      "ok",
    );
  });

  it("EVM wrong network stays wrong_network", () => {
    const eth: ActiveAccount = {
      ...EVM,
      chainId: 11155111,
      namespace: mintKargainNamespace(11155111),
    };
    assert.equal(
      deriveChainSelectorState({ account: eth, expectedNamespace: 84532 }),
      "wrong_network",
    );
  });

  it("disconnected → ok", () => {
    assert.equal(
      deriveChainSelectorState({
        account: { status: "disconnected" },
        expectedNamespace: 84532,
      }),
      "ok",
    );
  });
});
