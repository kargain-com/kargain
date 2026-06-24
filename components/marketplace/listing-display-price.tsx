"use client";

import { useDisplayCurrency } from "@/lib/marketplace/display-currency-context";
import { normalizeListingFiatCurrency } from "@/lib/marketplace/price-normalize";
import { cn } from "@/lib/utils";

const PRICE_CLASS =
  "text-lg font-medium text-accent-warm transition-colors duration-200";

type Props = {
  fiatPrice1e8: string | bigint;
  fiatCurrency: number | string;
  /** Show "Price" label above amount (listing detail sidebar). */
  showLabel?: boolean;
  className?: string;
};

export function ListingDisplayPrice({
  fiatPrice1e8,
  fiatCurrency,
  showLabel = false,
  className,
}: Props) {
  const { convertPrice } = useDisplayCurrency();
  const amount =
    typeof fiatPrice1e8 === "bigint" ? fiatPrice1e8 : BigInt(fiatPrice1e8);
  const price = convertPrice(amount, normalizeListingFiatCurrency(fiatCurrency));

  if (showLabel) {
    return (
      <div className={className}>
        <p className="font-sans text-xs text-text-tertiary">Price</p>
        <p className={PRICE_CLASS}>{price}</p>
      </div>
    );
  }

  return <p className={cn(PRICE_CLASS, className)}>{price}</p>;
}
