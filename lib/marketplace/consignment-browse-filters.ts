/**
 * Pure consignments browse filter parse + price-bound resolution.
 * SQL assembly lives in `src/lib/ponder-consignment-browse.ts` (Ponder schema).
 */

import type { MarketSort } from "@/lib/marketplace/filter-params";
import {
  displayAmountToUsd1e8,
  isPriceCurrency,
  parseFxRatesFromQuery,
  rateRequiredForPriceCurrency,
  type PartialFxRates,
  type PriceCurrency,
} from "@/lib/marketplace/price-normalize";

export type ConsignmentBrowseFilters = {
  search?: string;
  make?: string;
  model?: string;
  yearMin?: number;
  yearMax?: number;
  mileageMin?: number;
  mileageMax?: number;
  fuelTypes?: string[];
  bodyTypes?: string[];
  transmissions?: string[];
  conditions?: string[];
  vehicleTypes?: string[];
  placeId?: string;
  colour?: string;
  status?: "all" | "VERIFIED" | "UNVERIFIED" | "DISPUTED";
  priceMin?: string;
  priceMax?: string;
  priceCurrency?: PriceCurrency;
  eurUsdRate?: string;
  ethUsdRate?: string;
  btcUsdRate?: string;
  cnyUsdRate?: string;
  inrUsdRate?: string;
  brlUsdRate?: string;
  idrUsdRate?: string;
  audUsdRate?: string;
  aedUsdRate?: string;
  krwUsdRate?: string;
  rubUsdRate?: string;
  jpyUsdRate?: string;
  sort?: MarketSort;
  verifiedFirst?: boolean;
};

export type PriceBoundsUsd1e8 = {
  min?: bigint;
  max?: bigint;
};

export function splitCsvFilter(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseOptionalInt(raw: string | undefined): number | undefined {
  if (!raw?.trim()) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

function parsePriceCurrency(raw: string | undefined): PriceCurrency | undefined {
  if (raw && isPriceCurrency(raw)) return raw;
  return undefined;
}

export function parseConsignmentBrowseFilters(
  query: Record<string, string | undefined>,
): ConsignmentBrowseFilters {
  const statusRaw = query.status;
  const status =
    statusRaw === "VERIFIED" ||
    statusRaw === "UNVERIFIED" ||
    statusRaw === "DISPUTED"
      ? statusRaw
      : "all";
  const sortRaw = query.sort;
  const sort: MarketSort =
    sortRaw === "price_asc" ||
    sortRaw === "price_desc" ||
    sortRaw === "mileage_asc"
      ? sortRaw
      : "newest";
  const verifiedRaw = query.verifiedFirst;

  return {
    search: query.search?.trim() || undefined,
    make: query.make?.trim() || undefined,
    model: query.model?.trim() || undefined,
    yearMin: parseOptionalInt(query.yearMin),
    yearMax: parseOptionalInt(query.yearMax),
    mileageMin: parseOptionalInt(query.mileageMin),
    mileageMax: parseOptionalInt(query.mileageMax),
    fuelTypes: splitCsvFilter(query.fuelType),
    bodyTypes: splitCsvFilter(query.bodyType),
    transmissions: splitCsvFilter(query.transmission),
    conditions: splitCsvFilter(query.condition),
    vehicleTypes: splitCsvFilter(query.vehicleType),
    placeId: query.placeId?.trim() || undefined,
    colour: query.colour?.trim() || undefined,
    status,
    priceMin: query.priceMin?.trim() || undefined,
    priceMax: query.priceMax?.trim() || undefined,
    priceCurrency: parsePriceCurrency(query.priceCurrency),
    eurUsdRate: query.eurUsdRate?.trim() || undefined,
    ethUsdRate: query.ethUsdRate?.trim() || undefined,
    btcUsdRate: query.btcUsdRate?.trim() || undefined,
    cnyUsdRate: query.cnyUsdRate?.trim() || undefined,
    inrUsdRate: query.inrUsdRate?.trim() || undefined,
    brlUsdRate: query.brlUsdRate?.trim() || undefined,
    idrUsdRate: query.idrUsdRate?.trim() || undefined,
    audUsdRate: query.audUsdRate?.trim() || undefined,
    aedUsdRate: query.aedUsdRate?.trim() || undefined,
    krwUsdRate: query.krwUsdRate?.trim() || undefined,
    rubUsdRate: query.rubUsdRate?.trim() || undefined,
    jpyUsdRate: query.jpyUsdRate?.trim() || undefined,
    sort,
    /** Opt-in for consignments (unlike /passports default-on). */
    verifiedFirst: verifiedRaw === "true",
  };
}

/**
 * Resolve filter display amounts to USD 1e8.
 * `undefined` = no bounds; `null` = bounds requested but FX failed (fail-closed).
 */
export function resolveFilterBoundsUsd1e8(
  filters: ConsignmentBrowseFilters,
  rates: PartialFxRates | null,
): PriceBoundsUsd1e8 | null | undefined {
  const hasMin = Boolean(filters.priceMin?.trim());
  const hasMax = Boolean(filters.priceMax?.trim());
  if (!hasMin && !hasMax) return undefined;

  const priceCurrency = filters.priceCurrency ?? "USD";
  const min = hasMin
    ? displayAmountToUsd1e8(filters.priceMin!, priceCurrency, rates)
    : undefined;
  const max = hasMax
    ? displayAmountToUsd1e8(filters.priceMax!, priceCurrency, rates)
    : undefined;
  if (hasMin && min == null) return null;
  if (hasMax && max == null) return null;
  if (rateRequiredForPriceCurrency(priceCurrency)) {
    // Already fail-closed above when rates missing.
  }
  return { min, max };
}

export { parseFxRatesFromQuery };
