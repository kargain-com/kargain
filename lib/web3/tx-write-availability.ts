/**
 * Write-lifecycle availability causes (S8-3).
 * Parallel to requireEvmSession — never an absent value.
 *
 * S8-D0: {@link txWriteAvailabilityForCapability} composes surface-support
 * (capability × namespace) then the session check. Lifecycle callers keep
 * {@link txWriteAvailability} unchanged.
 */

import {
  commercialActive,
  type CommercialRegistry,
} from "@/lib/web3/commercial-active";
import {
  type ActiveAccount,
  type WalletFamilyWanted,
  wrongVmActionCopy,
} from "@/lib/web3/active-account";
import {
  surfaceSupport,
  type SurfaceCapability,
  type SurfaceSupportTable,
} from "@/lib/web3/surface-support";

/** Unavailable write — `wrong_vm` always names the wanted family. */
export type TxWriteUnavailable =
  | { available: false; cause: "disconnected" }
  | { available: false; cause: "wrong_vm"; wanted: WalletFamilyWanted }
  | { available: false; cause: "unresolved_namespace" }
  | {
      available: false;
      cause: "not_in_program" | "product_owner_owed" | "authority_only";
    };

export type TxWriteAvailability =
  | { available: true; vm: "evm"; walletChainId: number }
  | { available: true; vm: "svm"; namespace: number }
  | TxWriteUnavailable;

/**
 * Whether the active account may run a commercial write targeting `chainId`.
 * Both EVM and SVM commercial stacks are admitted when the session VM matches.
 * Missing commercial row → unresolved_namespace (never invent a stack).
 * VM mismatch → wrong_vm with `wanted` = the target stack's family.
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
      return { available: false, cause: "wrong_vm", wanted: stack.vm };
    }
    return { available: true, vm: "evm", walletChainId: account.chainId };
  }
  if (account.vm !== "svm") {
    return { available: false, cause: "wrong_vm", wanted: stack.vm };
  }
  return { available: true, vm: "svm", namespace: Number(stack.namespace) };
}

/**
 * Capability × namespace support, then session check against the wanted family.
 * Behaviour-neutral vs {@link txWriteAvailability} for capabilities that are
 * supported with family === stack.vm on every commercial namespace (S8-D0 migrate set).
 * Disconnected is named before namespace resolution (same order as {@link txWriteAvailability}).
 */
export function txWriteAvailabilityForCapability(
  account: ActiveAccount,
  capability: SurfaceCapability,
  namespace: number,
  registry?: CommercialRegistry,
  table?: SurfaceSupportTable,
): TxWriteAvailability {
  if (account.status !== "connected") {
    return { available: false, cause: "disconnected" };
  }
  const support = surfaceSupport(capability, namespace, registry, table);
  if ("unresolved" in support) {
    return { available: false, cause: "unresolved_namespace" };
  }
  if (!support.supported) {
    return { available: false, cause: support.cause };
  }
  if (account.vm !== support.family) {
    return { available: false, cause: "wrong_vm", wanted: support.family };
  }
  if (account.vm === "evm") {
    return { available: true, vm: "evm", walletChainId: account.chainId };
  }
  return { available: true, vm: "svm", namespace };
}

/** Stable English for write refusals — §4.7 vocabulary for wrong_vm. */
export function txWriteRefusalMessage(refusal: TxWriteUnavailable): string {
  switch (refusal.cause) {
    case "disconnected":
      return "Connect a wallet to send this transaction.";
    case "wrong_vm":
      return wrongVmActionCopy(refusal.wanted);
    case "unresolved_namespace":
      return "This network is not available for commercial writes.";
    case "not_in_program":
      return "This action is not available on this network.";
    case "product_owner_owed":
      return "This action is not available on this network yet.";
    case "authority_only":
      return "This action requires network authority on this network.";
  }
}

/**
 * Title for dual-VM write-session refusal chrome.
 * Surface-specific `disconnectedTitle` applies **only** to `disconnected`.
 * `wrong_vm` / `unresolved_namespace` always use {@link txWriteRefusalMessage}
 * — never a generic "connect your wallet" override (design-spec §4.7).
 */
export function txWriteRefusalTitle(
  refusal: TxWriteUnavailable,
  disconnectedTitle?: string,
): string {
  if (refusal.cause === "disconnected" && disconnectedTitle) {
    return disconnectedTitle;
  }
  return txWriteRefusalMessage(refusal);
}
