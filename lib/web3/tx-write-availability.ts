/**
 * Write-lifecycle availability causes (S8-3).
 * Parallel to requireEvmSession — never an absent value.
 */

import {
  type ActiveAccount,
  wrongVmActionCopy,
} from "@/lib/web3/active-account";
import { commercialActive } from "@/lib/web3/commercial-active";

export type TxWriteCause =
  | "disconnected"
  | "wrong_vm"
  | "unresolved_namespace";

export type TxWriteAvailability =
  | { available: true; vm: "evm"; walletChainId: number }
  | { available: false; cause: TxWriteCause };

/**
 * Whether the active account may run a commercial write targeting `chainId`.
 * EVM commercial stacks only today — SVM sessions refuse with wrong_vm;
 * missing commercial row → unresolved_namespace (never invent a stack).
 */
export function txWriteAvailability(
  account: ActiveAccount,
  chainId: number,
): TxWriteAvailability {
  if (account.status !== "connected") {
    return { available: false, cause: "disconnected" };
  }
  if (account.vm === "svm") {
    return { available: false, cause: "wrong_vm" };
  }
  const stack = commercialActive(chainId);
  if (stack == null || stack.vm !== "evm") {
    return { available: false, cause: "unresolved_namespace" };
  }
  return { available: true, vm: "evm", walletChainId: account.chainId };
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
