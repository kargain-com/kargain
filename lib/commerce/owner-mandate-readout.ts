/**
 * Owner-facing mandate / consignment terms + proceeds readout.
 *
 * Meaning for compensation forms lives in {@link compensation-form.ts}.
 * Split arithmetic mirrors {@link computeAgentedSplit} /
 * `ConsignmentBase._computeAgentedSplitAmounts`. Components render this
 * model; they do not restate money consequences.
 */

import { formatUnits } from "viem";

import { computeAgentedSplit } from "@/lib/commerce/agented-split";
import {
  compensationFormDef,
} from "@/lib/commerce/compensation-form";
import {
  COMPENSATION_FORM,
  type CompensationForm,
} from "@/lib/commerce/denomination";
import type { FloorDisplayUnits } from "@/lib/commerce/floor-display";
import type { CommerceMode } from "@/lib/commerce/mode";

export type OwnerMandateProceeds =
  | {
      readonly kind: "fixed";
      /** From compensation-form `ownerReceives` — no computed amount. */
      readonly statement: string;
    }
  | {
      readonly kind: "variable";
      readonly amountLabel: string;
      readonly ownerAmount: bigint;
      /**
       * Body: remainder moves with a listed price the owner does not set.
       * Composed from the commission form definition.
       */
      readonly movesWithPrice: string;
    }
  | { readonly kind: "absent" };

export type OwnerMandateTermsReadout = {
  readonly formLabel: string;
  /** Commission rate e.g. `"5%"`; null under Margin. */
  readonly rateLabel: string | null;
  /** Floor with unit when display units resolved; null while unread. */
  readonly floorLabel: string | null;
  readonly floor: bigint;
  readonly unitLabel: string | null;
  /** Owner-facing consequence from the form definition. */
  readonly ownerReceives: string;
  readonly proceeds: OwnerMandateProceeds;
};

function formatAmountLabel(
  amount: bigint,
  units: FloorDisplayUnits,
): string {
  const raw = formatUnits(amount, units.decimals);
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return `${raw} ${units.unitLabel}`;
  return `${n.toLocaleString("en-US", { maximumFractionDigits: 8 })} ${units.unitLabel}`;
}

/** Commission bps → display percent (500 → `"5%"`; 250 → `"2.5%"`). */
export function commissionRateLabel(commissionBps: number): string {
  const pct = commissionBps / 100;
  if (!Number.isFinite(pct) || pct <= 0) return "0%";
  const rounded =
    Number.isInteger(pct) || Math.abs(pct - Math.round(pct)) < 1e-9
      ? String(Math.round(pct))
      : String(Number(pct.toFixed(2)));
  return `${rounded}%`;
}

/**
 * Body when Commission owner proceeds are shown against a listed FixedPrice.
 * Composed from the form definition — not a warning.
 */
export const COMMISSION_PROCEEDS_MOVES_WITH_PRICE =
  `${compensationFormDef(COMPENSATION_FORM.Commission).ownerReceives} That remainder moves with the listed price, which you do not set.`;

/**
 * Body when Commission owner proceeds are shown against an ascending bid level.
 */
export const COMMISSION_PROCEEDS_MOVES_WITH_BID =
  `${compensationFormDef(COMPENSATION_FORM.Commission).ownerReceives} That remainder moves with the winning bid, which you do not set.`;

export type DeriveOwnerMandateReadoutInput = {
  compensationForm: CompensationForm;
  commissionBps: number;
  floor: bigint;
  /** Resolved via {@link floorDisplayUnits}; null while unread. */
  units: FloorDisplayUnits | null;
  /**
   * Settled / list / current-bid amount in the same denomination as floor.
   * Pass for live consignments when the amount is known; omit for awaiting mandates.
   */
  settled?: bigint | null;
  /** Snapshotted consignment platform fee; required for variable proceeds. */
  platformFeeBps?: number | bigint | null;
  mode?: CommerceMode;
};

/**
 * Derive terms + proceeds for an owner portfolio row.
 * Fail closed: no floor/proceeds figure without display units; no variable
 * figure without settled amount, platform fee, and a passing floor check.
 */
export function deriveOwnerMandateReadout(
  input: DeriveOwnerMandateReadoutInput,
): OwnerMandateTermsReadout {
  const def = compensationFormDef(input.compensationForm);
  const isCommission =
    input.compensationForm === COMPENSATION_FORM.Commission;
  const rateLabel = isCommission
    ? commissionRateLabel(input.commissionBps)
    : null;

  const units = input.units;
  const floorLabel =
    units != null ? formatAmountLabel(input.floor, units) : null;

  if (!isCommission) {
    return {
      formLabel: def.label,
      rateLabel: null,
      floorLabel,
      floor: input.floor,
      unitLabel: units?.unitLabel ?? null,
      ownerReceives: def.ownerReceives,
      proceeds: { kind: "fixed", statement: def.ownerReceives },
    };
  }

  const ascending = input.mode === "ascending";
  const settled = input.settled;
  const feeRaw = input.platformFeeBps;
  const feeReady =
    feeRaw != null &&
    (typeof feeRaw === "bigint"
      ? true
      : Number.isFinite(feeRaw) && feeRaw >= 0);

  let proceeds: OwnerMandateProceeds = { kind: "absent" };

  if (units != null && settled != null && settled > 0n && feeReady) {
    const platformFeeBps =
      typeof feeRaw === "bigint" ? feeRaw : BigInt(feeRaw as number);
    const split = computeAgentedSplit({
      settled,
      floor: input.floor,
      compensationForm: COMPENSATION_FORM.Commission,
      commissionBps: input.commissionBps,
      platformFeeBps,
    });
    if (split.ok) {
      proceeds = {
        kind: "variable",
        ownerAmount: split.ownerAmount,
        amountLabel: formatAmountLabel(split.ownerAmount, units),
        movesWithPrice: ascending
          ? COMMISSION_PROCEEDS_MOVES_WITH_BID
          : COMMISSION_PROCEEDS_MOVES_WITH_PRICE,
      };
    }
  }

  return {
    formLabel: def.label,
    rateLabel,
    floorLabel,
    floor: input.floor,
    unitLabel: units?.unitLabel ?? null,
    ownerReceives: def.ownerReceives,
    proceeds,
  };
}
