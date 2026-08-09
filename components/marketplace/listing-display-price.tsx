"use client";

import { useDisplayCurrency } from "@/lib/marketplace/display-currency-context";
import { browsePrice } from "@/lib/design/instrument-classes";
import {
  askingSettlementDisclosure,
  deriveListingAskingPrice,
  formatListingAssetAsking,
  toAskingDisplaySource,
} from "@/lib/commerce/listing-price-display";
import { resolveSettlementAssetMeta } from "@/lib/commerce/settlement-asset-meta";
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

export function ListingDisplayPrice({
  facts,
  showLabel = false,
  label = "asking",
  className,
}: Props) {
  const { convertPrice, ethUsd } = useDisplayCurrency();
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

  const displaySource = toAskingDisplaySource(asking, {
    ethUsd1e8: ethUsd ?? null,
  });

  let primary: string;
  if (asking.status === "unresolved") {
    primary = "—";
  } else if (displaySource != null) {
    primary = convertPrice(displaySource.amount1e8, displaySource.listingCurrency);
  } else if (asking.status === "asset") {
    primary = formatListingAssetAsking(
      asking.amount,
      asking.decimals,
      asking.unitLabel,
    );
  } else {
    primary = "—";
  }

  const settlementUnit =
    asking.status === "asset"
      ? asking.unitLabel
      : resolveSettlementAssetMeta({
          chainId: facts.chainId,
          asset: facts.asset,
        }).label;
  const disclosure =
    asking.status === "asset" || asking.status === "fiat"
      ? askingSettlementDisclosure(settlementUnit)
      : null;

  const labelText = label === "asking" ? "Asking price" : "Price";

  if (showLabel) {
    return (
      <div className={className}>
        <p className="font-sans text-xs text-text-tertiary">{labelText}</p>
        <p className={PRICE_CLASS}>{primary}</p>
        {disclosure ? (
          <p className="font-sans text-xs text-text-secondary">{disclosure}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className={cn(className)}>
      <p className={PRICE_CLASS}>{primary}</p>
      {disclosure ? (
        <p className="font-sans text-xs text-text-secondary">{disclosure}</p>
      ) : null}
    </div>
  );
}
