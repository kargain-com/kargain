/**
 * Pending-claims chrome fact — known | pending | refused.
 * Admission refusals are carried unchanged. Read causes only map indexer/address
 * failures. Never invents total 0 from an unread or refused admission.
 */

import type { PendingClaimView } from "@/lib/claims/map-pending-claim";
import type { SurfaceAdmissionRefusal } from "@/lib/web3/surface-admission";

/** Indexer / address read causes — never remapped admission statuses. */
export type PendingClaimsReadCause =
  | "PONDER_UNAVAILABLE"
  | "PONDER_MALFORMED_RESPONSE"
  | "INVALID_ADDRESS";

export const PENDING_CLAIMS_READ_CAUSES = [
  "PONDER_UNAVAILABLE",
  "PONDER_MALFORMED_RESPONSE",
  "INVALID_ADDRESS",
] as const satisfies ReadonlyArray<PendingClaimsReadCause>;

/** Const array covers every PendingClaimsReadCause (cannot drift). */
type _PendingClaimsReadCausesExhaustive = Exclude<
  PendingClaimsReadCause,
  (typeof PENDING_CLAIMS_READ_CAUSES)[number]
> extends never
  ? true
  : never;
const _pendingClaimsReadCausesExhaustive: _PendingClaimsReadCausesExhaustive =
  true;
void _pendingClaimsReadCausesExhaustive;

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

export type PendingClaimsRefusalPresentation = {
  readonly title: string;
  readonly description: string;
  readonly variant: "infrastructure" | "content";
};

const CLAIMS_DISCONNECTED_TITLE = "Connect a wallet to see claims.";

/**
 * Read-cause sentences + EmptyState variant. Classification lives here — chrome
 * never enumerates causes.
 */
export function pendingClaimsRefusalCopy(
  cause: PendingClaimsReadCause,
): PendingClaimsRefusalPresentation {
  switch (cause) {
    case "PONDER_UNAVAILABLE":
      return {
        title: "Claims unavailable",
        description: "The indexer could not be reached. Try again shortly.",
        variant: "infrastructure",
      };
    case "PONDER_MALFORMED_RESPONSE":
      return {
        title: "Claims unavailable",
        description: "The indexer returned an unreadable response.",
        variant: "infrastructure",
      };
    case "INVALID_ADDRESS":
      return {
        title: "Claims need a valid Ethereum address.",
        description: "",
        variant: "content",
      };
    default: {
      const _exhaustive: never = cause;
      return _exhaustive;
    }
  }
}

export type PendingClaimsRefusedPresentation =
  | {
      readonly mode: "admission";
      readonly refusal: SurfaceAdmissionRefusal;
      readonly disconnectedTitle: string;
    }
  | {
      readonly mode: "read";
      readonly title: string;
      readonly description: string;
      readonly variant: "infrastructure" | "content";
    };

/**
 * Sole refused chrome for pending-claims — admission vs read. Screens switch
 * only on `mode` from this owner.
 */
export function pendingClaimsRefusedPresentation(
  fact: Extract<PendingClaimsFact, { status: "refused" }>,
): PendingClaimsRefusedPresentation {
  if ("refusal" in fact) {
    return {
      mode: "admission",
      refusal: fact.refusal,
      disconnectedTitle: CLAIMS_DISCONNECTED_TITLE,
    };
  }
  const copy = pendingClaimsRefusalCopy(fact.cause);
  return {
    mode: "read",
    title: copy.title,
    description: copy.description,
    variant: copy.variant,
  };
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
