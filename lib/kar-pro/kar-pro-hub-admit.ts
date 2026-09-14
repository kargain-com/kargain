/**
 * KarPro hub session admit (U6.2-fix).
 * SVM reaches the fee island; EVM keeps the full hub.
 * Product consumers see `admission` capabilities — not `"evm"` / `"svm"` kinds.
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
      admission: "full";
      address: `0x${string}`;
      walletChainId: number;
      namespace: KargainNamespace;
    }
  | {
      admission: "fee_only";
      address: string;
      chainId: number;
      namespace: KargainNamespace;
    }
  | {
      admission: "refusal";
      cause: EvmSessionCause | "unresolved_namespace" | "staking_not_configured";
    };

/**
 * Admit a connected session into the KarPro hub.
 * - full: address + wallet chain (existing join/profile path).
 * - fee_only: fee island when commercial staking exists on the sole SVM namespace.
 * Missing EVM multicall must not invent inactive for fee_only (caller never asks).
 */
export function admitKarProHub(
  account: ActiveAccount,
  registry?: CommercialRegistry,
): KarProHubAdmit {
  if (account.status !== "connected") {
    return { admission: "refusal", cause: "disconnected" };
  }

  if (account.vm === "svm") {
    const ns = commercialNamespaceOf(account, registry);
    if (!ns.ok) {
      return { admission: "refusal", cause: ns.cause };
    }
    const chainId = Number(ns.namespace);
    const stack = commercialActive(chainId, registry);
    if (stack == null || stack.vm !== "svm" || !stack.karProStaking) {
      return { admission: "refusal", cause: "staking_not_configured" };
    }
    return {
      admission: "fee_only",
      address: account.address,
      chainId,
      namespace: ns.namespace,
    };
  }

  const evm = requireEvmSession(account);
  if (!evm.ok) {
    return { admission: "refusal", cause: evm.cause };
  }
  return {
    admission: "full",
    address: evm.address,
    walletChainId: evm.chainId,
    namespace: evm.namespace,
  };
}
