/**
 * Compensation form meaning — owner/agent money consequences live here,
 * not in whichever dialog renders the grant terms step.
 *
 * Mirrors commerce-model §5: margin pays the owner exactly the floor;
 * commission takes a granted rate and leaves the remainder with the owner.
 */

import {
  COMPENSATION_FORM,
  type Compensation,
  type CompensationForm,
} from "@/lib/commerce/denomination";

export type CompensationFormDef = {
  readonly form: CompensationForm;
  /** Short label for selectors. */
  readonly label: string;
  /** Owner-facing body: what the owner receives. */
  readonly ownerReceives: string;
  /** Owner-facing body: what the agent receives. */
  readonly agentReceives: string;
  /** Combined consequence statement shown at grant. */
  readonly consequence: string;
};

export const MARGIN_FORM_DEF: CompensationFormDef = {
  form: COMPENSATION_FORM.Margin,
  label: "Margin",
  ownerReceives: "You receive exactly your floor.",
  agentReceives:
    "Your agent keeps everything above the floor after the platform share.",
  consequence:
    "You receive exactly your floor. Your agent keeps everything above it after the platform share.",
};

export const COMMISSION_FORM_DEF: CompensationFormDef = {
  form: COMPENSATION_FORM.Commission,
  label: "Commission",
  ownerReceives:
    "You keep everything remaining after the platform share and the agent’s commission, and that remainder must meet your floor.",
  agentReceives: "Your agent takes the commission rate you grant of the settled amount.",
  consequence:
    "Your agent takes the commission rate you grant of the settled amount. You keep the remainder after the platform share, and that remainder must meet your floor.",
};

export const COMPENSATION_FORM_DEFS: readonly CompensationFormDef[] = [
  MARGIN_FORM_DEF,
  COMMISSION_FORM_DEF,
];

export function compensationFormDef(
  form: CompensationForm,
): CompensationFormDef {
  return form === COMPENSATION_FORM.Commission
    ? COMMISSION_FORM_DEF
    : MARGIN_FORM_DEF;
}

/**
 * Body copy for owner `lowerFloor` — composed from the form definition.
 * Lowering the floor changes what the owner is guaranteed (margin payout line
 * or commission remainder constraint).
 */
export function lowerFloorConcessionEffect(form: CompensationForm): string {
  if (form === COMPENSATION_FORM.Commission) {
    return `${COMMISSION_FORM_DEF.ownerReceives} Lowering the floor lowers that minimum.`;
  }
  return `${MARGIN_FORM_DEF.ownerReceives} Lowering it reduces that amount.`;
}

/**
 * Body copy for agent `lowerCommission` — composed from the commission
 * definition. Lowering the rate changes the agent’s share and the owner’s
 * remainder.
 */
export function lowerCommissionConcessionEffect(): string {
  return `${COMMISSION_FORM_DEF.agentReceives} Lowering the rate reduces that share and increases the remainder that must still meet the floor.`;
}

/** Build on-chain Compensation from a selected form + optional commission %. */
export function buildCompensation(input: {
  form: CompensationForm;
  /** Percent string or number, e.g. "5" → 500 bps. Ignored for Margin. */
  commissionPercent?: string | number | null;
}): Compensation | { ok: false; reason: string } {
  if (input.form === COMPENSATION_FORM.Margin) {
    return { form: COMPENSATION_FORM.Margin, commissionBps: 0 };
  }
  const raw = input.commissionPercent;
  if (raw == null || (typeof raw === "string" && raw.trim() === "")) {
    return { ok: false, reason: "Enter a commission rate." };
  }
  const pct = typeof raw === "number" ? raw : Number(raw.trim());
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
    return {
      ok: false,
      reason: "Commission must be greater than 0% and at most 100%.",
    };
  }
  const commissionBps = Math.round(pct * 100);
  if (commissionBps <= 0 || commissionBps > 10_000) {
    return {
      ok: false,
      reason: "Commission must be greater than 0% and at most 100%.",
    };
  }
  return { form: COMPENSATION_FORM.Commission, commissionBps };
}

/**
 * Model R4 / C7 — fact the owner must know before granting a fixed-price
 * mandate. Body copy at grant, not a warning banner.
 */
export const EXTERNAL_PAYMENT_GRANT_DISCLOSURE =
  "Your agent can record an off-protocol payment and transfer the vehicle without money passing through Kargain and without checking your floor. That path relies on your agreement with the agent, not on protocol enforcement.";
