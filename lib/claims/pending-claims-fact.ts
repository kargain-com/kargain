/**
 * Pending-claims chrome fact — known | pending | refused.
 * Admission refusals are carried unchanged. Read causes only map indexer/address
 * failures. Never invents total 0 from an unread or refused admission.
 */

import type { PendingClaimView } from "@/lib/claims/map-pending-claim";
import {
  type SurfaceAdmissionRefusal,
  surfaceAdmissionRefusalCopy,
} from "@/lib/web3/surface-admission";

/** Indexer / address read causes — never remapped admission statuses. */
export type PendingClaimsReadCause =
  | "PONDER_UNAVAILABLE"
  | "PONDER_NOT_CONFIGURED"
  | "INVALID_ADDRESS";

export const PENDING_CLAIMS_READ_CAUSES = [
  "PONDER_UNAVAILABLE",
  "PONDER_NOT_CONFIGURED",
  "INVALID_ADDRESS",
] as const satisfies ReadonlyArray<PendingClaimsReadCause>;

export type PendingClaimsFact =
  | {
      readonly status: "known";
      readonly claims: readonly PendingClaimView[];
      readonly total: number;
    }
  | { readonly status: "pending" }
  | {
      readonly status: "refused";
      readonly refusal: SurfaceAdmissionRefusal;
    }
  | {
      readonly status: "refused";
      readonly cause: PendingClaimsReadCause;
    };

export type PendingClaimsRefusalCopy = {
  readonly title: string;
  readonly description: string;
};

/**
 * Read-cause sentences only. Admission refusals use
 * {@link surfaceAdmissionRefusalCopy}.
 */
export function pendingClaimsRefusalCopy(
  cause: PendingClaimsReadCause,
): PendingClaimsRefusalCopy {
  switch (cause) {
    case "PONDER_UNAVAILABLE":
      return {
        title: "Claims unavailable",
        description: "The indexer could not be reached. Try again shortly.",
      };
    case "PONDER_NOT_CONFIGURED":
      return {
        title: "Claims unavailable",
        description: "The indexer is not configured for this environment.",
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

/** Chrome copy for any refused pending-claims fact. */
export function pendingClaimsFactRefusalCopy(
  fact: Extract<PendingClaimsFact, { status: "refused" }>,
): PendingClaimsRefusalCopy {
  if ("refusal" in fact) {
    return surfaceAdmissionRefusalCopy(fact.refusal, {
      disconnectedTitle: "Connect a wallet to see claims.",
    });
  }
  return pendingClaimsRefusalCopy(fact.cause);
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
        readonly error: PendingClaimsReadCause;
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
    return { status: "refused", cause: args.data.error };
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
