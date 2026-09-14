/**
 * KarPro hub session admit (U6.2 minimal).
 * SVM reaches the fee island; EVM keeps the full hub. VM fork lives here.
 */

import {
  commercialNamespaceOf,
  requireEvmSession,
  type ActiveAccount,
  type EvmSessionCause,
} from "@/lib/web3/active-account";
import {
  commercialActive,
  type CommercialRegistry,
} from "@/lib/web3/commercial-active";
import type { KargainNamespace } from "@/lib/web3/kargain-namespace";

export type KarProHubAdmit =
  | {
      kind: "evm";
      address: `0x${string}`;
      walletChainId: number;
      namespace: KargainNamespace;
    }
  | {
      kind: "svm_fee_island";
      address: string;
      chainId: number;
      namespace: KargainNamespace;
    }
  | {
      kind: "refusal";
      cause: EvmSessionCause | "unresolved_namespace" | "staking_not_configured";
    };

/**
 * Admit a connected session into the KarPro hub.
 * - EVM: address + wallet chain (existing join/profile path).
 * - SVM: fee island only when commercial staking exists on the sole SVM namespace.
 * Missing EVM multicall must not invent inactive for SVM (caller never asks).
 */
export function admitKarProHub(
  account: ActiveAccount,
  registry?: CommercialRegistry,
): KarProHubAdmit {
  if (account.status !== "connected") {
    return { kind: "refusal", cause: "disconnected" };
  }

  if (account.vm === "svm") {
    const ns = commercialNamespaceOf(account, registry);
    if (!ns.ok) {
      return { kind: "refusal", cause: ns.cause };
    }
    const chainId = Number(ns.namespace);
    const stack = commercialActive(chainId, registry);
    if (stack == null || stack.vm !== "svm" || !stack.karProStaking) {
      return { kind: "refusal", cause: "staking_not_configured" };
    }
    return {
      kind: "svm_fee_island",
      address: account.address,
      chainId,
      namespace: ns.namespace,
    };
  }

  const evm = requireEvmSession(account);
  if (!evm.ok) {
    return { kind: "refusal", cause: evm.cause };
  }
  return {
    kind: "evm",
    address: evm.address,
    walletChainId: evm.chainId,
    namespace: evm.namespace,
  };
}
