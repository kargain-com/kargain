"use client";

import { useDisplayCurrency } from "@/lib/marketplace/display-currency-context";
import { normalizeListingFiatCurrency } from "@/lib/marketplace/price-normalize";
import { cn } from "@/lib/utils";

const PRICE_CLASS =
  "font-mono text-lg font-medium tabular-nums text-text-primary";

type Props = {
  fiatPrice1e8: string | bigint;
  fiatCurrency: number | string;
  /** Show label above amount (listing detail sidebar). */
  showLabel?: boolean;
  /** Label when showLabel is true. */
  label?: "asking" | "price";
  className?: string;
};

export function ListingDisplayPrice({
  fiatPrice1e8,
  fiatCurrency,
  showLabel = false,
  label = "asking",
  className,
}: Props) {
  const { convertPrice } = useDisplayCurrency();
  const amount =
    typeof fiatPrice1e8 === "bigint" ? fiatPrice1e8 : BigInt(fiatPrice1e8);
  const price = convertPrice(amount, normalizeListingFiatCurrency(fiatCurrency));
  const labelText = label === "asking" ? "Asking price" : "Price";

  if (showLabel) {
    return (
      <div className={className}>
        <p className="font-sans text-xs text-text-tertiary">{labelText}</p>
        <p className={PRICE_CLASS}>{price}</p>
      </div>
    );
  }

  return <p className={cn(PRICE_CLASS, className)}>{price}</p>;
}
