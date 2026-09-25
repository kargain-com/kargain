/**
 * S8-D1b / D2 — sole commerce-fact shape: known | pending | refused(cause).
 * Causes are KeyedReadCause (network/decoding) or surfaceSupport causes.
 * No second cause list. Refused facts always carry a non-empty sentence (§4.21).
 */

import type { KeyedReadCause } from "@/lib/web3/keyed-multicall";
import {
  surfaceSupportCauseCopy,
  type SurfaceSupportCause,
} from "@/lib/web3/surface-support";

export type { SurfaceSupportCause };

export type CommerceFactCause = KeyedReadCause | SurfaceSupportCause;

/** Closed list for exhaustive copy plants. */
export const COMMERCE_FACT_CAUSES = [
  "rpc_unavailable",
  "account_not_found",
  "malformed_response",
  "unresolved_namespace",
  "evm_call_failed",
  "not_in_program",
  "product_owner_owed",
  "authority_only",
] as const satisfies ReadonlyArray<CommerceFactCause>;

export type CommerceFact<T> =
  | { readonly status: "known"; readonly value: T }
  | { readonly status: "pending" }
  | { readonly status: "refused"; readonly cause: CommerceFactCause };

export function commerceFactKnown<T>(value: T): CommerceFact<T> {
  return { status: "known", value };
}

export function commerceFactPending<T>(): CommerceFact<T> {
  return { status: "pending" };
}

export function commerceFactRefused<T>(
  cause: CommerceFactCause,
): CommerceFact<T> {
  return { status: "refused", cause };
}

/**
 * Refusal sentence for a refused commerce fact. Never empty. Waiting
 * (`pending`) is not a cause and must not call this. Support causes delegate
 * to {@link surfaceSupportCauseCopy}.
 */
export function commerceFactCauseCopy(cause: CommerceFactCause): string {
  switch (cause) {
    case "rpc_unavailable":
      return "The network did not answer.";
    case "account_not_found":
      return "This account does not exist on this network.";
    case "malformed_response":
      return "The network's answer could not be read.";
    case "unresolved_namespace":
      return "This network is not configured in the app.";
    case "evm_call_failed":
      return "The chain did not return this value.";
    case "not_in_program":
    case "authority_only":
    case "product_owner_owed":
      return surfaceSupportCauseCopy(cause);
    default: {
      const _exhaustive: never = cause;
      return _exhaustive;
    }
  }
}

/**
 * Combine two phase facts into a derived OR (hasLive) or mode pick.
 * Known only when both are known; refuse if either refuses (carry that cause);
 * pending otherwise.
 */
export function combinePhaseFacts(
  fixedPriceLive: CommerceFact<boolean>,
  ascendingLive: CommerceFact<boolean>,
): {
  hasLiveConsignment: CommerceFact<boolean>;
  liveConsignmentMode: CommerceFact<"fixedPrice" | "ascending" | null>;
} {
  if (
    fixedPriceLive.status === "refused" ||
    ascendingLive.status === "refused"
  ) {
    const cause =
      fixedPriceLive.status === "refused"
        ? fixedPriceLive.cause
        : (ascendingLive as Extract<CommerceFact<boolean>, { status: "refused" }>)
            .cause;
    return {
      hasLiveConsignment: commerceFactRefused(cause),
      liveConsignmentMode: commerceFactRefused(cause),
    };
  }
  if (
    fixedPriceLive.status === "pending" ||
    ascendingLive.status === "pending"
  ) {
    return {
      hasLiveConsignment: commerceFactPending(),
      liveConsignmentMode: commerceFactPending(),
    };
  }
  const hasLive = fixedPriceLive.value || ascendingLive.value;
  const mode: "fixedPrice" | "ascending" | null = fixedPriceLive.value
    ? "fixedPrice"
    : ascendingLive.value
      ? "ascending"
      : null;
  return {
    hasLiveConsignment: commerceFactKnown(hasLive),
    liveConsignmentMode: commerceFactKnown(mode),
  };
}
