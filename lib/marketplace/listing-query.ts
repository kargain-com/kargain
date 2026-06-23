import type { MarketSort } from "@/lib/marketplace/filter-params";

export type ListingFilterQuery = {
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
  location?: string;
  colour?: string;
  status?: "all" | "VERIFIED" | "UNVERIFIED" | "DISPUTED";
  priceMin?: string;
  priceMax?: string;
  sort?: MarketSort;
};

export type PassportFilterFields = {
  passportStatus: string;
  vin: string;
  make: string;
  model: string;
  year: number;
  mileageKm: number;
  fuelType: string;
  bodyType: string;
  transmission: string;
  condition?: string;
  vehicleType?: string;
  colour?: string;
  locationLabel?: string;
};

export type ListingFilterFields = {
  fiatPrice1e8: bigint;
  fiatCurrency: number;
  listedAt: bigint;
};

export type EnrichedListingForFilter = ListingFilterFields & PassportFilterFields;

export function splitCsvFilter(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function fiatCodeToCurrency(code: number): "USD" | "EUR" {
  return code === 1 ? "EUR" : "USD";
}

/** Scale a plain display price (e.g. "15000") to USD 1e8 for comparison. */
function displayPriceToUsd1e8(amount: string): bigint | undefined {
  const trimmed = amount.trim();
  if (!trimmed) return undefined;
  const n = Number.parseFloat(trimmed);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return BigInt(Math.round(n * 100_000_000));
}

// TODO: inject eurUsd rate from Chainlink event cache for accurate cross-currency sort/filter
/** Normalize listing price to USD 1e8; EUR rows use EUR ≈ USD fallback when no live rate. */
export function listingUsd1e8(row: ListingFilterFields): bigint {
  if (row.fiatCurrency === 0) return row.fiatPrice1e8;
  return row.fiatPrice1e8;
}

function parseOptionalInt(raw: string | undefined): number | undefined {
  if (!raw?.trim()) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

export function parseListingFilterQuery(
  query: Record<string, string | undefined>,
): ListingFilterQuery {
  const statusRaw = query.status;
  const status =
    statusRaw === "VERIFIED" || statusRaw === "UNVERIFIED" || statusRaw === "DISPUTED"
      ? statusRaw
      : "all";
  const sortRaw = query.sort;
  const sort: MarketSort =
    sortRaw === "price_asc" || sortRaw === "price_desc" || sortRaw === "mileage_asc"
      ? sortRaw
      : "newest";

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
    location: query.location?.trim() || undefined,
    colour: query.colour?.trim() || undefined,
    status,
    priceMin: query.priceMin?.trim() || undefined,
    priceMax: query.priceMax?.trim() || undefined,
    sort,
  };
}

function includesCsvMatch(selected: string[], value: string): boolean {
  if (selected.length === 0) return true;
  if (!value) return false;
  const normalized = value.toLowerCase();
  return selected.some((item) => item.toLowerCase() === normalized);
}

function substringMatch(needle: string | undefined, haystack: string | undefined): boolean {
  if (!needle) return true;
  if (!haystack) return false;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

export function matchesListingFilters(
  row: EnrichedListingForFilter,
  filters: ListingFilterQuery,
): boolean {
  if (filters.make && row.make.toLowerCase() !== filters.make.toLowerCase()) {
    return false;
  }
  if (filters.model && row.model.toLowerCase() !== filters.model.toLowerCase()) {
    return false;
  }
  if (filters.yearMin != null && row.year < filters.yearMin) return false;
  if (filters.yearMax != null && row.year > filters.yearMax) return false;
  if (filters.mileageMin != null && filters.mileageMin > 0 && row.mileageKm < filters.mileageMin) {
    return false;
  }
  if (filters.mileageMax != null && row.mileageKm > filters.mileageMax) return false;
  if (filters.status && filters.status !== "all" && row.passportStatus !== filters.status) {
    return false;
  }

  const rowUsd1e8 = listingUsd1e8(row);
  const minUsd1e8 = filters.priceMin ? displayPriceToUsd1e8(filters.priceMin) : undefined;
  const maxUsd1e8 = filters.priceMax ? displayPriceToUsd1e8(filters.priceMax) : undefined;
  if (minUsd1e8 != null && rowUsd1e8 < minUsd1e8) return false;
  if (maxUsd1e8 != null && rowUsd1e8 > maxUsd1e8) return false;

  if (!includesCsvMatch(filters.fuelTypes ?? [], row.fuelType)) return false;
  if (!includesCsvMatch(filters.bodyTypes ?? [], row.bodyType)) return false;
  if (!includesCsvMatch(filters.transmissions ?? [], row.transmission)) return false;
  if (!includesCsvMatch(filters.conditions ?? [], row.condition ?? "")) return false;
  if (!includesCsvMatch(filters.vehicleTypes ?? [], row.vehicleType ?? "")) return false;
  if (!substringMatch(filters.location, row.locationLabel)) return false;
  if (!substringMatch(filters.colour, row.colour)) return false;

  if (filters.search) {
    const q = filters.search.toLowerCase();
    const haystack = [row.make, row.model, row.vin].map((s) => s.toLowerCase());
    if (!haystack.some((s) => s.includes(q))) return false;
  }

  return true;
}

export function sortEnrichedListings<T extends EnrichedListingForFilter>(
  rows: T[],
  sort: MarketSort,
  verifiedFirst: boolean,
): T[] {
  const copy = [...rows];
  const rank = (status: string) =>
    status === "VERIFIED" ? 0 : status === "UNVERIFIED" ? 1 : 2;

  copy.sort((a, b) => {
    if (verifiedFirst) {
      const dr = rank(a.passportStatus) - rank(b.passportStatus);
      if (dr !== 0) return dr;
    }

    switch (sort) {
      case "price_asc": {
        const aUsd = listingUsd1e8(a);
        const bUsd = listingUsd1e8(b);
        if (aUsd < bUsd) return -1;
        if (aUsd > bUsd) return 1;
        break;
      }
      case "price_desc": {
        const aUsd = listingUsd1e8(a);
        const bUsd = listingUsd1e8(b);
        if (aUsd < bUsd) return 1;
        if (aUsd > bUsd) return -1;
        break;
      }
      case "mileage_asc":
        return a.mileageKm - b.mileageKm;
      default:
        if (a.listedAt > b.listedAt) return -1;
        if (a.listedAt < b.listedAt) return 1;
        return 0;
    }

    if (a.listedAt > b.listedAt) return -1;
    if (a.listedAt < b.listedAt) return 1;
    return 0;
  });

  return copy;
}

export type ListingFacets = {
  makes: string[];
  models: Record<string, string[]>;
  yearMin: number;
  yearMax: number;
  years: number[];
  mileageMax: number;
  fuelTypes: string[];
  bodyTypes: string[];
  transmissions: string[];
  conditions: string[];
  vehicleTypes: string[];
  priceRanges: {
    USD: { min: number; max: number };
    EUR: { min: number; max: number };
  };
  fiatCurrencies: number[];
  totalActive: number;
  statusCounts: Record<"UNVERIFIED" | "VERIFIED" | "DISPUTED", number>;
};

function fiat1e8ToDisplay(raw: bigint): number {
  return Number(raw) / 100_000_000;
}

export function computeListingFacets(
  rows: EnrichedListingForFilter[],
  totalActive: number,
  fiatCurrencies: number[],
): ListingFacets {
  const makes = new Set<string>();
  const models: Record<string, Set<string>> = {};
  const fuelTypes = new Set<string>();
  const bodyTypes = new Set<string>();
  const transmissions = new Set<string>();
  const conditions = new Set<string>();
  const vehicleTypes = new Set<string>();
  const years = new Set<number>();
  let yearMin = Number.MAX_SAFE_INTEGER;
  let yearMax = 0;
  let mileageMax = 0;
  const statusCounts = { UNVERIFIED: 0, VERIFIED: 0, DISPUTED: 0 };
  const priceRanges = {
    USD: { min: Number.POSITIVE_INFINITY, max: 0 },
    EUR: { min: Number.POSITIVE_INFINITY, max: 0 },
  };

  for (const row of rows) {
    if (row.make) {
      makes.add(row.make);
      if (!models[row.make]) models[row.make] = new Set();
      if (row.model) models[row.make].add(row.model);
    }
    if (row.year > 0) {
      years.add(row.year);
      yearMin = Math.min(yearMin, row.year);
      yearMax = Math.max(yearMax, row.year);
    }
    if (row.mileageKm > 0) mileageMax = Math.max(mileageMax, row.mileageKm);
    if (row.fuelType) fuelTypes.add(row.fuelType);
    if (row.bodyType) bodyTypes.add(row.bodyType);
    if (row.transmission) transmissions.add(row.transmission);
    if (row.condition) conditions.add(row.condition);
    if (row.vehicleType) vehicleTypes.add(row.vehicleType);
    if (row.passportStatus in statusCounts) {
      statusCounts[row.passportStatus as keyof typeof statusCounts] += 1;
    }

    const currency = fiatCodeToCurrency(row.fiatCurrency);
    const display = fiat1e8ToDisplay(row.fiatPrice1e8);
    if (display > 0) {
      priceRanges[currency].min = Math.min(priceRanges[currency].min, display);
      priceRanges[currency].max = Math.max(priceRanges[currency].max, display);
    }
  }

  const normalizeRange = (range: { min: number; max: number }) => ({
    min: Number.isFinite(range.min) ? range.min : 0,
    max: range.max,
  });

  return {
    makes: [...makes].sort(),
    models: Object.fromEntries(
      Object.entries(models).map(([k, v]) => [k, [...v].sort()]),
    ),
    yearMin: yearMin === Number.MAX_SAFE_INTEGER ? 0 : yearMin,
    yearMax,
    years: [...years].sort((a, b) => a - b),
    mileageMax,
    fuelTypes: [...fuelTypes].sort(),
    bodyTypes: [...bodyTypes].sort(),
    transmissions: [...transmissions].sort(),
    conditions: [...conditions].sort(),
    vehicleTypes: [...vehicleTypes].sort(),
    priceRanges: {
      USD: normalizeRange(priceRanges.USD),
      EUR: normalizeRange(priceRanges.EUR),
    },
    fiatCurrencies,
    totalActive,
    statusCounts,
  };
}
