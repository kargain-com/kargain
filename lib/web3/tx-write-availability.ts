/**
 * Write-lifecycle availability causes (S8-3).
 * Parallel to requireEvmSession — never an absent value.
 *
 * S8-D4: {@link txWriteAvailabilityForCapability} adapts
 * {@link admitSurface} (census then session). Lifecycle callers keep
 * {@link txWriteAvailability} unchanged.
 */

import {
  commercialActive,
  unresolvedNamespaceCopy,
  type CommercialRegistry,
} from "@/lib/web3/commercial-active";
import {
  type ActiveAccount,
  type WalletFamilyWanted,
  wrongVmActionCopy,
} from "@/lib/web3/active-account";
import { admitSurface } from "@/lib/web3/surface-admission";
import {
  surfaceSupportCauseCopy,
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
 * Capability × namespace via {@link admitSurface} (census then session).
 * Behaviour-neutral vs {@link txWriteAvailability} for capabilities that are
 * supported with family === stack.vm on every commercial namespace (S8-D0 migrate set).
 */
export function txWriteAvailabilityForCapability(
  account: ActiveAccount,
  capability: SurfaceCapability,
  namespace: number,
  registry?: CommercialRegistry,
  table?: SurfaceSupportTable,
): TxWriteAvailability {
  const admission = admitSurface(
    account,
    capability,
    namespace,
    registry,
    table,
  );
  switch (admission.status) {
    case "unresolved_namespace":
      return { available: false, cause: "unresolved_namespace" };
    case "support_refused":
      return { available: false, cause: admission.cause };
    case "disconnected":
      return { available: false, cause: "disconnected" };
    case "family_required":
    case "wrong_family":
      return { available: false, cause: "wrong_vm", wanted: admission.wanted };
    case "available":
      if (admission.family === "evm") {
        return {
          available: true,
          vm: "evm",
          walletChainId: admission.chainId,
        };
      }
      return {
        available: true,
        vm: "svm",
        namespace: admission.namespace,
      };
  }
}

/** Stable English for write refusals — §4.7 vocabulary for wrong_vm. */
export function txWriteRefusalMessage(refusal: TxWriteUnavailable): string {
  switch (refusal.cause) {
    case "disconnected":
      return "Connect a wallet to send this transaction.";
    case "wrong_vm":
      return wrongVmActionCopy(refusal.wanted);
    case "unresolved_namespace":
      return unresolvedNamespaceCopy();
    case "not_in_program":
    case "product_owner_owed":
    case "authority_only":
      return surfaceSupportCauseCopy(refusal.cause);
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
