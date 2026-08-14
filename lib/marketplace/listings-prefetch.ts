import type { MarketFilterState } from "@/lib/marketplace/filter-params";
import {
  rateRequiredForPriceCurrency,
  ratesReadyForPriceCurrency,
  type PartialFxRates,
  type PriceCurrency,
} from "@/lib/marketplace/price-normalize";

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

/**
 * Forward live FX to Ponder when price bounds or price sort are active
 * (USD+USDC Asking still works without rates; native lots need ethUsd when present).
 */
export function marketplaceListingsShouldForwardRates(
  filters: MarketFilterState,
): boolean {
  return (
    marketplaceListingsNeedClientRates(filters) ||
    Boolean(filters.priceMin.trim() || filters.priceMax.trim())
  );
}

/** True when required FX rates for browse filters/sort are available. */
export function marketplaceListingsRatesReady(
  filters: MarketFilterState,
  rates: PartialFxRates | null,
): boolean {
  if (!marketplaceListingsNeedClientRates(filters)) return true;

  const hasPriceFilter = Boolean(filters.priceMin.trim() || filters.priceMax.trim());
  const priceCurrency = effectivePriceCurrency(filters);
  const needsRatesForFilter = hasPriceFilter && rateRequiredForPriceCurrency(priceCurrency);
  const needsRatesForSort = filters.sort === "price_asc" || filters.sort === "price_desc";

  const ratesReadyForFilter =
    !needsRatesForFilter || ratesReadyForPriceCurrency(priceCurrency, rates);
  const ratesReadyForSort =
    !needsRatesForSort || (rates?.ethUsd != null && rates?.eurUsd != null);

  return ratesReadyForFilter && ratesReadyForSort;
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
