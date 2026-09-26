/**
 * Pending-claims chrome fact — known | pending | refused.
 * Never invents total 0 from an unread or refused admission.
 * Failed indexer reads refuse with PONDER_UNAVAILABLE (never known).
 */

import type { PendingClaimView } from "@/lib/claims/map-pending-claim";
import { unresolvedNamespaceCopy } from "@/lib/web3/commercial-active";
import {
  SURFACE_SUPPORT_CAUSES,
  surfaceSupportCauseCopy,
  type SurfaceSupportCause,
} from "@/lib/web3/surface-support";

export type PendingClaimsRefusedCause =
  | SurfaceSupportCause
  | "disconnected"
  | "unresolved_namespace"
  | "wrong_vm"
  | "PONDER_UNAVAILABLE"
  | "INVALID_ADDRESS";

export const PENDING_CLAIMS_REFUSED_CAUSES = [
  ...SURFACE_SUPPORT_CAUSES,
  "disconnected",
  "unresolved_namespace",
  "wrong_vm",
  "PONDER_UNAVAILABLE",
  "INVALID_ADDRESS",
] as const satisfies ReadonlyArray<PendingClaimsRefusedCause>;

export type PendingClaimsFact =
  | {
      readonly status: "known";
      readonly claims: readonly PendingClaimView[];
      readonly total: number;
    }
  | { readonly status: "pending" }
  | {
      readonly status: "refused";
      readonly cause: PendingClaimsRefusedCause;
    };

export type PendingClaimsRefusalCopy = {
  readonly title: string;
  readonly description: string;
};

/**
 * Sole refusal sentence owner for pending-claims chrome.
 * Support causes delegate to surfaceSupportCauseCopy; no catch-all.
 */
export function pendingClaimsRefusalCopy(
  cause: PendingClaimsRefusedCause,
): PendingClaimsRefusalCopy {
  switch (cause) {
    case "not_in_program":
    case "product_owner_owed":
    case "authority_only":
      return { title: surfaceSupportCauseCopy(cause), description: "" };
    case "disconnected":
      return {
        title: "Connect a wallet to see claims.",
        description: "",
      };
    case "unresolved_namespace":
      return { title: unresolvedNamespaceCopy(), description: "" };
    case "wrong_vm":
      return {
        title: "Claims need an Ethereum wallet.",
        description: "",
      };
    case "PONDER_UNAVAILABLE":
      return {
        title: "Claims unavailable",
        description: "The indexer could not be reached. Try again shortly.",
      };
    case "INVALID_ADDRESS":
      return {
        title: "Claims need a valid Ethereum address.",
        description: "",
      };
    default: {
      const _exhaustive: never = cause;
      return _exhaustive;
    }
  }
}

/**
 * Map a getPendingClaims Result (or transport failure) into a fact.
 * Pure — plants prove PONDER_UNAVAILABLE → refused, never known.
 */
export function pendingClaimsFactFromQueryResult(args: {
  readonly isError: boolean;
  readonly isPending: boolean;
  readonly data:
    | {
        readonly ok: true;
        readonly claims: readonly PendingClaimView[];
        readonly total: number;
      }
    | {
        readonly ok: false;
        readonly error: "PONDER_UNAVAILABLE" | "INVALID_ADDRESS" | "PONDER_NOT_CONFIGURED";
      }
    | null
    | undefined;
}): PendingClaimsFact {
  if (args.isError) {
    return { status: "refused", cause: "PONDER_UNAVAILABLE" };
  }
  if (args.isPending || args.data == null) {
    return { status: "pending" };
  }
  if (!args.data.ok) {
    if (args.data.error === "PONDER_NOT_CONFIGURED") {
      return { status: "refused", cause: "PONDER_UNAVAILABLE" };
    }
    return { status: "refused", cause: args.data.error };
  }
  return {
    status: "known",
    claims: args.data.claims,
    total: args.data.total,
  };
}

/** ca3164e defect: treat indexer failure as known zero — red under plant. */
export function pendingClaimsFactFromQueryResultCa3164e(args: {
  readonly isError: boolean;
  readonly isPending: boolean;
  readonly data:
    | {
        readonly claims: readonly PendingClaimView[];
        readonly total: number;
        readonly ponderError: string | null;
      }
    | null
    | undefined;
}): PendingClaimsFact {
  if (args.isError) {
    return { status: "refused", cause: "PONDER_UNAVAILABLE" };
  }
  if (args.isPending || args.data == null) {
    return { status: "pending" };
  }
  return {
    status: "known",
    claims: args.data.claims,
    total: args.data.total,
  };
}

export function pendingClaimsKnownTotal(fact: PendingClaimsFact): number | null {
  return fact.status === "known" ? fact.total : null;
}
