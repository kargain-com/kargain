/**
 * Sole owner of "does this namespace have an indexed commerce browse source?".
 * Ponder `kargain.consignment` is the only catalog today (EIP-155 commercial).
 * SVM commercial stacks are registered but have no consignment projection —
 * selected Solana must refuse by name, never show another network's lots.
 *
 * Unscoped (no namespace selected) keeps today's multi-source browse.
 */

import {
  commercialActive,
  isCommercialEip155Id,
  unresolvedNamespaceCopy,
  type CommercialRegistry,
  COMMERCIAL_ACTIVE,
} from "@/lib/web3/commercial-active";

/**
 * Closed refusal when a selected commercial namespace has no indexer commerce
 * table. Distinct from SurfaceSupportCause / CommerceModeAbsentCause.
 */
export type CommerceBrowseSourceCause = "no_indexed_commerce";

export const COMMERCE_BROWSE_SOURCE_CAUSES = [
  "no_indexed_commerce",
] as const satisfies ReadonlyArray<CommerceBrowseSourceCause>;

/** Sole chrome sentence for {@link CommerceBrowseSourceCause}. Never empty. */
export function commerceBrowseSourceCauseCopy(
  cause: CommerceBrowseSourceCause,
): string {
  switch (cause) {
    case "no_indexed_commerce":
      return "This network has no indexed commerce yet.";
    default: {
      const _exhaustive: never = cause;
      return _exhaustive;
    }
  }
}

/**
 * True when the namespace has a Ponder consignment browse source.
 * Today: commercial EIP-155 only. Flip here when SVM projection gains lots.
 */
export function hasIndexedCommerceSource(
  namespace: number,
  registry: CommercialRegistry = COMMERCIAL_ACTIVE,
): boolean {
  return isCommercialEip155Id(namespace, registry);
}

export type CommerceBrowseSourceAdmission =
  | { readonly status: "unscoped" }
  | { readonly status: "available"; readonly namespace: number }
  | {
      readonly status: "refused";
      readonly cause: "no_indexed_commerce";
      readonly namespace: number;
    }
  | { readonly status: "refused"; readonly cause: "unresolved_namespace" };

/**
 * Admit a selected browse namespace (or absence of selection).
 * - null / non-finite → unscoped (query without chainId)
 * - commercial + indexed source → available (pass chainId)
 * - commercial + no source → no_indexed_commerce
 * - finite but not commercial → unresolved_namespace (delegate copy)
 */
export function admitCommerceBrowseSource(
  namespace: number | null | undefined,
  registry: CommercialRegistry = COMMERCIAL_ACTIVE,
): CommerceBrowseSourceAdmission {
  if (namespace == null || !Number.isFinite(namespace)) {
    return { status: "unscoped" };
  }
  const stack = commercialActive(namespace, registry);
  if (stack == null) {
    return { status: "refused", cause: "unresolved_namespace" };
  }
  if (hasIndexedCommerceSource(namespace, registry)) {
    return { status: "available", namespace };
  }
  return {
    status: "refused",
    cause: "no_indexed_commerce",
    namespace,
  };
}

/** chainId query value for Ponder — only when admission is available. */
export function browseSourceChainIdQuery(
  admission: CommerceBrowseSourceAdmission,
): number | undefined {
  return admission.status === "available" ? admission.namespace : undefined;
}

/**
 * Chrome sentence for a browse refusal cause. no_indexed_commerce from this
 * owner; unresolved_namespace delegates to commercial-active.
 */
export function commerceBrowseSourceRefusalCopy(
  cause: CommerceBrowseSourceCause | "unresolved_namespace",
): string {
  if (cause === "unresolved_namespace") {
    return unresolvedNamespaceCopy();
  }
  return commerceBrowseSourceCauseCopy(cause);
}
