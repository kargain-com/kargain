/**
 * Unread-alerts badge fact — known | pending | refused.
 * Admission refusals are carried unchanged. Never invents count 0 from an
 * unread or family-bound refusal.
 */

import type { SurfaceAdmissionRefusal } from "@/lib/web3/surface-admission";

export type UnreadAlertsFact =
  | { readonly status: "known"; readonly count: number }
  | { readonly status: "pending" }
  | {
      readonly status: "refused";
      readonly refusal: SurfaceAdmissionRefusal;
    };

export function unreadAlertsKnownCount(fact: UnreadAlertsFact): number | null {
  return fact.status === "known" ? fact.count : null;
}
