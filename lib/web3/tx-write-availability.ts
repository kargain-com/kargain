/**
 * Write-lifecycle availability causes (S8-3).
 * Parallel to requireEvmSession — never an absent value.
 */

import {
  commercialActive,
  type CommercialRegistry,
} from "@/lib/web3/commercial-active";
import {
  type ActiveAccount,
  wrongVmActionCopy,
} from "@/lib/web3/active-account";

export type TxWriteCause =
  | "disconnected"
  | "wrong_vm"
  | "unresolved_namespace";

export type TxWriteAvailability =
  | { available: true; vm: "evm"; walletChainId: number }
  | { available: true; vm: "svm"; namespace: number }
  | { available: false; cause: TxWriteCause };

/**
 * Whether the active account may run a commercial write targeting `chainId`.
 * EVM commercial stacks only today — SVM sessions refuse with wrong_vm;
 * missing commercial row → unresolved_namespace (never invent a stack).
 */
export function txWriteAvailability(
  account: ActiveAccount,
  chainId: number,
  registry?: CommercialRegistry,
): TxWriteAvailability {
  if (account.status !== "connected") {
    return { available: false, cause: "disconnected" };
  }
  const stack = commercialActive(chainId, registry);
  if (stack == null) {
    return { available: false, cause: "unresolved_namespace" };
  }
  if (stack.vm === "evm") {
    if (account.vm !== "evm") {
      return { available: false, cause: "wrong_vm" };
    }
    return { available: true, vm: "evm", walletChainId: account.chainId };
  }
  if (account.vm !== "svm") {
    return { available: false, cause: "wrong_vm" };
  }
  return { available: true, vm: "svm", namespace: Number(stack.namespace) };
}

/** Stable English for write refusals — §4.7 vocabulary for wrong_vm. */
export function txWriteRefusalMessage(cause: TxWriteCause): string {
  switch (cause) {
    case "disconnected":
      return "Connect a wallet to send this transaction.";
    case "wrong_vm":
      return wrongVmActionCopy("evm");
    case "unresolved_namespace":
      return "This network is not available for commercial writes.";
  }
}
