/**
 * Live-consignment concessions — owner may lower the snapshot floor; agent may
 * lower commission when the snapshot form is Commission. Availability is a
 * property of the consignment and the caller, not of which selling mode holds
 * it (Mandate.sol: no mode branch).
 */

import {
  AVAILABLE,
  blocked,
  type ActionGate,
  isAvailable,
} from "@/lib/challenge/action-gate";
import {
  COMPENSATION_FORM,
  type CompensationForm,
} from "@/lib/commerce/denomination";

export type OwnerLowerFloorCause =
  | "reads_unresolved"
  | "no_live_consignment"
  | "not_passport_owner"
  | "no_floor_headroom";

export type AgentLowerCommissionCause =
  | "reads_unresolved"
  | "no_live_consignment"
  | "not_consignment_agent"
  | "not_commission_form"
  | "no_commission_headroom";

export const CONCESSION_CAUSE_COPY: Record<
  OwnerLowerFloorCause | AgentLowerCommissionCause,
  string
> = {
  reads_unresolved: "Concession state is not available yet.",
  no_live_consignment: "Concessions apply only while a sale is live.",
  not_passport_owner: "Only the passport owner can lower the floor.",
  not_consignment_agent: "Only the consignment agent can lower the commission.",
  not_commission_form:
    "Commission can only be lowered when compensation is commission.",
  no_floor_headroom: "The floor cannot be lowered further.",
  no_commission_headroom: "The commission cannot be lowered further.",
};

export type OwnerLowerFloorInput = {
  /** `undefined` while live/unread is unresolved — fail closed. */
  live: boolean | undefined;
  isPassportOwner: boolean | undefined;
  /** Snapshotted consignment floor (not the standing mandate floor). */
  snapshotFloor: bigint | undefined;
};

export type AgentLowerCommissionInput = {
  live: boolean | undefined;
  isConsignmentAgent: boolean | undefined;
  compensationForm: CompensationForm | undefined;
  snapshotCommissionBps: number | undefined;
};

export function deriveOwnerLowerFloorConcession(
  input: OwnerLowerFloorInput,
): ActionGate<OwnerLowerFloorCause> {
  if (
    input.live === undefined ||
    input.isPassportOwner === undefined ||
    input.snapshotFloor === undefined
  ) {
    return blocked("reads_unresolved");
  }
  if (!input.live) return blocked("no_live_consignment");
  if (!input.isPassportOwner) return blocked("not_passport_owner");
  if (input.snapshotFloor <= 0n) return blocked("no_floor_headroom");
  return AVAILABLE;
}

export function deriveAgentLowerCommissionConcession(
  input: AgentLowerCommissionInput,
): ActionGate<AgentLowerCommissionCause> {
  if (
    input.live === undefined ||
    input.isConsignmentAgent === undefined ||
    input.compensationForm === undefined ||
    input.snapshotCommissionBps === undefined
  ) {
    return blocked("reads_unresolved");
  }
  if (!input.live) return blocked("no_live_consignment");
  if (!input.isConsignmentAgent) return blocked("not_consignment_agent");
  if (input.compensationForm !== COMPENSATION_FORM.Commission) {
    return blocked("not_commission_form");
  }
  if (input.snapshotCommissionBps <= 0) {
    return blocked("no_commission_headroom");
  }
  return AVAILABLE;
}

export { isAvailable as isConcessionAvailable };
