/**
 * Pending-claims chrome fact — known | pending | refused.
 * Never invents total 0 from an unread or refused admission.
 */

import type { PendingClaimView } from "@/lib/claims/map-pending-claim";
import type { SurfaceSupportCause } from "@/lib/web3/surface-support";

export type PendingClaimsFact =
  | {
      readonly status: "known";
      readonly claims: readonly PendingClaimView[];
      readonly total: number;
      readonly ponderError: string | null;
    }
  | { readonly status: "pending" }
  | {
      readonly status: "refused";
      readonly cause:
        | SurfaceSupportCause
        | "disconnected"
        | "unresolved_namespace"
        | "wrong_vm";
    };

export function pendingClaimsKnownTotal(fact: PendingClaimsFact): number | null {
  return fact.status === "known" ? fact.total : null;
}
