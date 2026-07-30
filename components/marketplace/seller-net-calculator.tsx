"use client";

import {
  agentedPriceMeetsFloor,
  computeAgentedSplit,
} from "@/lib/commerce/agented-split";
import {
  COMPENSATION_FORM,
  type CompensationForm,
} from "@/lib/commerce/denomination";
import { formatFiat1e8 } from "@/lib/marketplace/fiat-format";
import type { ListingCurrencyCode } from "@/lib/marketplace/currency-code";

export { agentedPriceMeetsFloor };

type Props = {
  price1e8: bigint | null;
  /** Mandate floor — the amount the owner is guaranteed. */
  floor1e8: bigint;
  compensationForm: CompensationForm;
  commissionBps: number;
  platformFeeBps: bigint | null | undefined;
  currencyCode: ListingCurrencyCode;
};

function formatAmount(amount: bigint, code: ListingCurrencyCode): string {
  const value = formatFiat1e8(amount);
  if (code === "USD") return `$${value}`;
  if (code === "EUR") return `€${value}`;
  if (code === "JPY") return `¥${value}`;
  return `${value} ${code}`;
}

/** Fee breakdown for an agented consignment, mirroring the on-chain split. */
export function SellerNetCalculator({
  price1e8,
  floor1e8,
  compensationForm,
  commissionBps,
  platformFeeBps,
  currencyCode,
}: Props) {
  if (price1e8 == null || price1e8 <= 0n) {
    return (
      <div className="rounded-md border border-border-default bg-bg-primary/80 p-4 text-sm text-text-secondary">
        Enter an asking price to see the fee breakdown.
      </div>
    );
  }

  if (platformFeeBps == null) {
    return (
      <div className="rounded-md border border-border-default bg-bg-primary/80 p-4 text-sm text-text-secondary">
        Loading platform fee…
      </div>
    );
  }

  const split = computeAgentedSplit({
    settled: price1e8,
    floor: floor1e8,
    compensationForm,
    commissionBps,
    platformFeeBps,
  });

  const compensationLabel =
    compensationForm === COMPENSATION_FORM.Margin
      ? "Your margin"
      : "Your commission";

  return (
    <div
      className={`rounded-md border p-3 text-sm ${
        split.ok
          ? "border-border-default bg-bg-primary/80"
          : "border-status-error/40 bg-bg-primary/80"
      }`}
    >
      <dl className="space-y-1.5">
        <div className="flex justify-between gap-4">
          <dt className="text-text-secondary">{compensationLabel}</dt>
          <dd className="font-mono tabular-nums text-text-primary">
            {formatAmount(split.agentAmount, currencyCode)}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-text-secondary">Platform fee</dt>
          <dd className="font-mono tabular-nums text-text-primary">
            {formatAmount(split.platform, currencyCode)}
          </dd>
        </div>
        <div className="flex justify-between gap-4 border-t border-border-default pt-1.5">
          <dt className="text-text-secondary">Owner receives</dt>
          <dd className="font-mono tabular-nums text-text-primary">
            {formatAmount(split.ownerAmount, currencyCode)}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-text-secondary">Owner minimum</dt>
          <dd className="font-mono tabular-nums text-text-primary">
            {formatAmount(floor1e8, currencyCode)}
          </dd>
        </div>
      </dl>

      {split.ok ? (
        <p className="mt-2 text-xs text-text-secondary">
          Owner receives {formatAmount(split.ownerAmount, currencyCode)}, at or
          above the mandate floor of {formatAmount(floor1e8, currencyCode)}.
        </p>
      ) : (
        <p className="mt-2 text-xs text-status-error" role="alert">
          This price is below the mandate floor of{" "}
          {formatAmount(floor1e8, currencyCode)}. Raise the price to continue.
        </p>
      )}
    </div>
  );
}
