/**
 * Unread-alerts badge fact — known | pending | refused.
 * Never invents count 0 from an unread or family-bound refusal.
 */

import type { SurfaceSupportCause } from "@/lib/web3/surface-support";

export type UnreadAlertsFact =
  | { readonly status: "known"; readonly count: number }
  | { readonly status: "pending" }
  | {
      readonly status: "refused";
      readonly cause:
        | SurfaceSupportCause
        | "disconnected"
        | "unresolved_namespace"
        | "family_required";
    };

export function unreadAlertsKnownCount(fact: UnreadAlertsFact): number | null {
  return fact.status === "known" ? fact.count : null;
}
