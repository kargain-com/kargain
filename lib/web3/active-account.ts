/**
 * Sole active-account vocabulary (S8-2-fix).
 * Entry answers who is connected; EVM-shaped projections refuse by name.
 */

import type { Connector } from "wagmi";

import type { KargainNamespace } from "@/lib/web3/kargain-namespace";

export type ActiveAccountDisconnected = {
  status: "disconnected";
};

export type ActiveAccountEvm = {
  status: "connected";
  vm: "evm";
  address: `0x${string}`;
  namespace: KargainNamespace;
  chainId: number;
};

/**
 * Solana session: address + vm only.
 * No commercial namespace until a COMMERCIAL_ACTIVE row exists (S9).
 */
export type ActiveAccountSvm = {
  status: "connected";
  vm: "svm";
  address: string;
};

export type ActiveAccount =
  | ActiveAccountDisconnected
  | ActiveAccountEvm
  | ActiveAccountSvm;

export type EvmSessionCause = "disconnected" | "wrong_vm";

export type EvmSessionResult =
  | {
      ok: true;
      address: `0x${string}`;
      chainId: number;
      namespace: KargainNamespace;
    }
  | { ok: false; cause: EvmSessionCause };

export type CommercialNamespaceCause =
  | "disconnected"
  | "unresolved_namespace";

export type CommercialNamespaceResult =
  | { ok: true; namespace: KargainNamespace }
  | { ok: false; cause: CommercialNamespaceCause };

export type EvmSwitchChainAvailability =
  | { available: true }
  | { available: false; cause: EvmSessionCause };

export type AccountSigningBinding =
  | {
      ok: true;
      family: "evm";
      connector: Connector;
      address: `0x${string}`;
      chainId: number;
      namespace: KargainNamespace;
    }
  | { ok: false; cause: EvmSessionCause };

export type ConnectTarget =
  | { family: "evm"; connector: Connector }
  | { family: "svm"; walletName: string };

export type ConnectOption =
  | {
      family: "evm";
      key: string;
      label: string;
      connector: Connector;
    }
  | {
      family: "svm";
      key: string;
      label: string;
      walletName: string;
    };

/** Display / copy address for any connected family; undefined when disconnected. */
export function connectedAddress(
  account: ActiveAccount,
): string | undefined {
  return account.status === "connected" ? account.address : undefined;
}

/** True when any wallet family is connected. */
export function isAccountConnected(account: ActiveAccount): boolean {
  return account.status === "connected";
}

/**
 * EVM session facts — answers for an EVM account, refuses by name otherwise.
 * Precedent: {@link eip155Of} (stack → EIP-155 or named refusal).
 */
export function requireEvmSession(account: ActiveAccount): EvmSessionResult {
  if (account.status !== "connected") {
    return { ok: false, cause: "disconnected" };
  }
  if (account.vm !== "evm") {
    return { ok: false, cause: "wrong_vm" };
  }
  return {
    ok: true,
    address: account.address,
    chainId: account.chainId,
    namespace: account.namespace,
  };
}

/** Wallet family the surface needs (design-spec §4.7). */
export type WalletFamilyWanted = "evm" | "svm";

/**
 * Wrong-VM chrome — exact design-spec §4.7 sentences.
 * Never a network-switch prompt; connect dialog is the action.
 */
export function wrongVmActionCopy(wanted: WalletFamilyWanted): string {
  switch (wanted) {
    case "evm":
      return "Connect an Ethereum wallet to act on this network";
    case "svm":
      return "Connect a Solana wallet to act on this network";
  }
}

/**
 * Named refusal when {@link requireEvmSession} is not ok.
 * `wrong_vm` uses §4.7; disconnected keeps a connect invitation.
 */
export function evmSessionRefusalCopy(cause: EvmSessionCause): string {
  switch (cause) {
    case "disconnected":
      return "Connect a wallet to continue.";
    case "wrong_vm":
      return wrongVmActionCopy("evm");
  }
}

/**
 * Commercial namespace of the active account.
 * SVM sessions have no registry row until S9 → `unresolved_namespace`
 * (never an invented endpoint-derived id).
 */
export function commercialNamespaceOf(
  account: ActiveAccount,
): CommercialNamespaceResult {
  if (account.status !== "connected") {
    return { ok: false, cause: "disconnected" };
  }
  if (account.vm === "svm") {
    return { ok: false, cause: "unresolved_namespace" };
  }
  return { ok: true, namespace: account.namespace };
}

/** Switch-chain action availability — named cause when the session cannot switch. */
export function evmSwitchChainAvailability(
  account: ActiveAccount,
): EvmSwitchChainAvailability {
  const session = requireEvmSession(account);
  if (!session.ok) {
    return { available: false, cause: session.cause };
  }
  return { available: true };
}

/**
 * EVM wallet-client / personal-sign binding.
 * Always a Result — never an absent connector field on the entry point.
 */
export function requireEvmSigningBinding(
  account: ActiveAccount,
  connector: Connector | undefined,
): AccountSigningBinding {
  const session = requireEvmSession(account);
  if (!session.ok) {
    return { ok: false, cause: session.cause };
  }
  if (connector == null) {
    return { ok: false, cause: "disconnected" };
  }
  return {
    ok: true,
    family: "evm",
    connector,
    address: session.address,
    chainId: session.chainId,
    namespace: session.namespace,
  };
}
