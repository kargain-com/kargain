import type { MarketFilterState } from "@/lib/marketplace/filter-params";
import { rateRequiredForPriceCurrency, type PriceCurrency } from "@/lib/marketplace/price-normalize";

function effectivePriceCurrency(filters: MarketFilterState): PriceCurrency {
  if (filters.priceCurrency) return filters.priceCurrency;
  return "USD";
}

/** True when browse listings cannot be fetched server-side without live client FX rates. */
export function marketplaceListingsNeedClientRates(filters: MarketFilterState): boolean {
  const hasPriceFilter = Boolean(filters.priceMin.trim() || filters.priceMax.trim());
  const needsRatesForFilter =
    hasPriceFilter && rateRequiredForPriceCurrency(effectivePriceCurrency(filters));
  const needsRatesForSort = filters.sort === "price_asc" || filters.sort === "price_desc";
  return needsRatesForFilter || needsRatesForSort;
}

export function searchParamsToUrlSearchParams(
  sp: Record<string, string | string[] | undefined>,
): URLSearchParams {
  const url = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      if (value[0]) url.set(key, value[0]);
    } else {
      url.set(key, value);
    }
  }
  return url;
}
