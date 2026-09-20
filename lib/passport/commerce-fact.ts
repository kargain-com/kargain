/**
 * S8-D1b — sole commerce-fact shape: known | pending | refused(cause).
 * Causes are KeyedReadCause (network/decoding) or surfaceSupport causes.
 * No second cause list.
 */

import type { KeyedReadCause } from "@/lib/web3/keyed-multicall";

/** Support causes from surfaceSupport — never invent a parallel vocabulary. */
export type SurfaceSupportCause =
  | "not_in_program"
  | "product_owner_owed"
  | "authority_only";

export type CommerceFactCause = KeyedReadCause | SurfaceSupportCause;

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
