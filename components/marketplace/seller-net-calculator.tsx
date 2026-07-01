"use client";

import {
  computeSellerNet,
  satisfiesOwnerMin,
  sellerNetSatisfied,
} from "@/lib/marketplace/seller-net";
import { formatFiat1e8 } from "@/lib/marketplace/fiat-format";
import type { ListingCurrencyCode } from "@/lib/marketplace/currency-code";

export { sellerNetSatisfied };

type Props = {
  price1e8: bigint | null;
  agentFeeBps: number;
  platformFeeBps: bigint | null | undefined;
  ownerMinPrice1e8: bigint;
  currencyCode: ListingCurrencyCode;
};

function formatAmount(amount: bigint, code: ListingCurrencyCode): string {
  const value = formatFiat1e8(amount);
  if (code === "USD") return `$${value}`;
  if (code === "EUR") return `€${value}`;
  if (code === "JPY") return `¥${value}`;
  return `${value} ${code}`;
}

export function SellerNetCalculator({
  price1e8,
  agentFeeBps,
  platformFeeBps,
  ownerMinPrice1e8,
  currencyCode,
}: Props) {
  if (price1e8 == null || price1e8 <= 0n) {
    return (
      <div className="rounded-md border border-border-default bg-bg-primary/80 p-3 text-sm text-text-secondary">
        Enter an asking price and commission to see the fee breakdown.
      </div>
    );
  }

  if (platformFeeBps == null) {
    return (
      <div className="rounded-md border border-border-default bg-bg-primary/80 p-3 text-sm text-text-secondary">
        Loading platform fee…
      </div>
    );
  }

  const { agentFee, platformFee, sellerNet } = computeSellerNet(
    price1e8,
    agentFeeBps,
    platformFeeBps,
  );
  const meetsMin = satisfiesOwnerMin(sellerNet, ownerMinPrice1e8);

  return (
    <div
      className={`rounded-md border p-3 text-sm ${
        meetsMin
          ? "border-border-default bg-bg-primary/80"
          : "border-status-error/40 bg-bg-primary/80"
      }`}
    >
      <dl className="space-y-1.5">
        <div className="flex justify-between gap-4">
          <dt className="text-text-secondary">Your commission</dt>
          <dd className="font-mono tabular-nums text-text-primary">
            {formatAmount(agentFee, currencyCode)}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-text-secondary">Platform fee</dt>
          <dd className="font-mono tabular-nums text-text-primary">
            {formatAmount(platformFee, currencyCode)}
          </dd>
        </div>
        <div className="flex justify-between gap-4 border-t border-border-default pt-1.5">
          <dt className="text-text-secondary">Owner receives</dt>
          <dd className="font-mono tabular-nums text-text-primary">
            {formatAmount(sellerNet, currencyCode)}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-text-secondary">Owner minimum</dt>
          <dd className="font-mono tabular-nums text-text-primary">
            {formatAmount(ownerMinPrice1e8, currencyCode)}
          </dd>
        </div>
      </dl>

      {meetsMin ? (
        <p className="mt-2 text-xs text-accent-warm">
          Owner receives {formatAmount(sellerNet, currencyCode)}, above the minimum of{" "}
          {formatAmount(ownerMinPrice1e8, currencyCode)}.
        </p>
      ) : (
        <p className="mt-2 text-xs text-status-error" role="alert">
          Owner would receive {formatAmount(sellerNet, currencyCode)}, below the minimum of{" "}
          {formatAmount(ownerMinPrice1e8, currencyCode)}. Submit is blocked until price or
          commission satisfies the owner&apos;s guarantee.
        </p>
      )}
    </div>
  );
}
