"use client";

import { useDisplayCurrency } from "@/lib/marketplace/display-currency-context";
import { browsePrice } from "@/lib/design/instrument-classes";
import {
  legacyFiatFromCurrencyCode,
  type LegacyFiatCurrency,
} from "@/lib/marketplace/currency-code";
import { normalizeListingFiatCurrency } from "@/lib/marketplace/price-normalize";
import {
  deriveListingAskingPrice,
  formatListingAssetAsking,
  type ListingAskingPrice,
} from "@/lib/commerce/listing-price-display";
import {
  DENOMINATION_KIND,
  type DenominationKind,
} from "@/lib/commerce/denomination";
import { cn } from "@/lib/utils";

const PRICE_CLASS = browsePrice;

export type ListingDisplayPriceFacts = {
  chainId: number;
  price: string | bigint;
  denominationKind: DenominationKind | number;
  asset?: string | null;
  currencyCode?: string | null;
  /** Legacy enum — used when currencyCode is absent for fiat lots. */
  fiatCurrency?: number | string;
  erc20Decimals?: number | null;
};

type Props = {
  facts: ListingDisplayPriceFacts;
  /** Show label above amount (listing detail sidebar). */
  showLabel?: boolean;
  /** Label when showLabel is true. */
  label?: "asking" | "price";
  className?: string;
};

function askingToDisplayString(
  asking: ListingAskingPrice,
  convertPrice: (
    amount1e8: bigint,
    fiatCurrency: LegacyFiatCurrency,
  ) => string,
  fiatCurrencyFallback: LegacyFiatCurrency,
): string {
  if (asking.status === "unresolved") return "—";
  if (asking.status === "asset") {
    return formatListingAssetAsking(
      asking.amount,
      asking.decimals,
      asking.unitLabel,
    );
  }
  const fiatEnum =
    asking.currencyCode && asking.currencyCode.length > 0
      ? normalizeListingFiatCurrency(
          legacyFiatFromCurrencyCode(asking.currencyCode),
        )
      : fiatCurrencyFallback;
  return convertPrice(asking.amount1e8, fiatEnum);
}

export function ListingDisplayPrice({
  facts,
  showLabel = false,
  label = "asking",
  className,
}: Props) {
  const { convertPrice } = useDisplayCurrency();
  const denominationKind =
    facts.denominationKind === DENOMINATION_KIND.Asset ||
    facts.denominationKind === DENOMINATION_KIND.Fiat
      ? facts.denominationKind
      : Number(facts.denominationKind) === DENOMINATION_KIND.Asset
        ? DENOMINATION_KIND.Asset
        : Number(facts.denominationKind) === DENOMINATION_KIND.Fiat
          ? DENOMINATION_KIND.Fiat
          : undefined;

  const asking = deriveListingAskingPrice({
    denominationKind,
    price: facts.price,
    currencyCode: facts.currencyCode,
    asset: facts.asset,
    chainId: facts.chainId,
    erc20Decimals: facts.erc20Decimals,
  });

  const fiatFallback =
    facts.fiatCurrency != null
      ? normalizeListingFiatCurrency(facts.fiatCurrency)
      : 0;
  const price = askingToDisplayString(asking, convertPrice, fiatFallback);
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
