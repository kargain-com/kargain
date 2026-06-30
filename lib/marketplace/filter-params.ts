import {
  isPriceCurrency,
  type PriceCurrency,
} from "@/lib/marketplace/price-normalize";
import type { LegacyFiatCurrencyCode } from "@/lib/marketplace/currency-code";
import { fiatCurrencySymbol } from "@/lib/marketplace/fiat-format";

export type MarketSort = "newest" | "price_asc" | "price_desc" | "mileage_asc";
export type VerificationFilter = "all" | "VERIFIED" | "UNVERIFIED" | "DISPUTED";

export type MarketFilterState = {
  search: string;
  make: string;
  model: string;
  yearMin: string;
  yearMax: string;
  priceMin: string;
  priceMax: string;
  priceCurrency: PriceCurrency | "";
  mileageMin: string;
  mileageMax: string;
  fuelTypes: string[];
  bodyTypes: string[];
  transmissions: string[];
  conditions: string[];
  vehicleTypes: string[];
  location: string;
  colour: string;
  status: VerificationFilter;
  sort: MarketSort;
  page: number;
};

export const DEFAULT_MARKET_FILTERS: MarketFilterState = {
  search: "",
  make: "",
  model: "",
  yearMin: "",
  yearMax: "",
  priceMin: "",
  priceMax: "",
  priceCurrency: "",
  mileageMin: "",
  mileageMax: "",
  fuelTypes: [],
  bodyTypes: [],
  transmissions: [],
  conditions: [],
  vehicleTypes: [],
  location: "",
  colour: "",
  status: "all",
  sort: "newest",
  page: 1,
};

const STATUS_LABELS: Record<Exclude<VerificationFilter, "all">, string> = {
  VERIFIED: "Verified",
  UNVERIFIED: "Unverified",
  DISPUTED: "Disputed",
};

function splitCsv(raw: string | null): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function filtersFromSearchParams(sp: URLSearchParams): MarketFilterState {
  const sortRaw = sp.get("sort");
  const sort: MarketSort =
    sortRaw === "price_asc" || sortRaw === "price_desc" || sortRaw === "mileage_asc"
      ? sortRaw
      : "newest";
  const statusRaw = sp.get("status");
  const status: VerificationFilter =
    statusRaw === "VERIFIED" || statusRaw === "UNVERIFIED" || statusRaw === "DISPUTED"
      ? statusRaw
      : "all";
  const pageRaw = sp.get("page");
  const pageN = pageRaw ? Number.parseInt(pageRaw, 10) : 1;
  const priceCurrencyRaw = sp.get("priceCurrency") ?? "";

  return {
    search: sp.get("search") ?? sp.get("q") ?? "",
    make: sp.get("make") ?? "",
    model: sp.get("model") ?? "",
    yearMin: sp.get("yearMin") ?? "",
    yearMax: sp.get("yearMax") ?? "",
    priceMin: sp.get("priceMin") ?? "",
    priceMax: sp.get("priceMax") ?? "",
    priceCurrency: isPriceCurrency(priceCurrencyRaw) ? priceCurrencyRaw : "",
    mileageMin: sp.get("mileageMin") ?? "",
    mileageMax: sp.get("mileageMax") ?? "",
    fuelTypes: splitCsv(sp.get("fuelType")),
    bodyTypes: splitCsv(sp.get("bodyType")),
    transmissions: splitCsv(sp.get("transmission")),
    conditions: splitCsv(sp.get("condition")),
    vehicleTypes: splitCsv(sp.get("vehicleType")),
    location: sp.get("location") ?? "",
    colour: sp.get("colour") ?? "",
    status,
    sort,
    page: Number.isFinite(pageN) && pageN >= 1 ? pageN : 1,
  };
}

export function filtersToSearchParams(filters: MarketFilterState): URLSearchParams {
  const sp = new URLSearchParams();
  if (filters.search) sp.set("search", filters.search);
  if (filters.make) sp.set("make", filters.make);
  if (filters.model) sp.set("model", filters.model);
  if (filters.yearMin) sp.set("yearMin", filters.yearMin);
  if (filters.yearMax) sp.set("yearMax", filters.yearMax);
  if (filters.priceMin) sp.set("priceMin", filters.priceMin);
  if (filters.priceMax) sp.set("priceMax", filters.priceMax);
  if (filters.priceMin || filters.priceMax) {
    if (filters.priceCurrency) sp.set("priceCurrency", filters.priceCurrency);
  }
  if (filters.mileageMin) sp.set("mileageMin", filters.mileageMin);
  if (filters.mileageMax) sp.set("mileageMax", filters.mileageMax);
  if (filters.fuelTypes.length) sp.set("fuelType", filters.fuelTypes.join(","));
  if (filters.bodyTypes.length) sp.set("bodyType", filters.bodyTypes.join(","));
  if (filters.transmissions.length) sp.set("transmission", filters.transmissions.join(","));
  if (filters.conditions.length) sp.set("condition", filters.conditions.join(","));
  if (filters.vehicleTypes.length) sp.set("vehicleType", filters.vehicleTypes.join(","));
  if (filters.location) sp.set("location", filters.location);
  if (filters.colour) sp.set("colour", filters.colour);
  if (filters.status !== "all") sp.set("status", filters.status);
  if (filters.sort !== "newest") sp.set("sort", filters.sort);
  if (filters.page > 1) sp.set("page", String(filters.page));
  return sp;
}

export function countActiveFilters(filters: MarketFilterState): number {
  let n = 0;
  if (filters.make) n++;
  if (filters.model) n++;
  if (filters.yearMin || filters.yearMax) n++;
  if (filters.priceMin || filters.priceMax) n++;
  if (filters.mileageMin || filters.mileageMax) n++;
  if (filters.fuelTypes.length) n++;
  if (filters.bodyTypes.length) n++;
  if (filters.transmissions.length) n++;
  if (filters.conditions.length) n++;
  if (filters.vehicleTypes.length) n++;
  if (filters.location) n++;
  if (filters.colour) n++;
  if (filters.status !== "all") n++;
  return n;
}

/** Filters managed in the drawer (excludes bar-only: search, status, price, make, fuel). */
export function countDrawerActiveFilters(filters: MarketFilterState): number {
  let n = 0;
  if (filters.model) n++;
  if (filters.yearMin || filters.yearMax) n++;
  if (filters.mileageMin || filters.mileageMax) n++;
  if (filters.bodyTypes.length) n++;
  if (filters.transmissions.length) n++;
  if (filters.conditions.length) n++;
  if (filters.vehicleTypes.length) n++;
  if (filters.location) n++;
  if (filters.colour) n++;
  return n;
}

function formatCompactPrice(amount: string, displayCurrency: PriceCurrency): string {
  const n = Number.parseFloat(amount);
  if (!Number.isFinite(n)) return amount;
  if (displayCurrency === "ETH") {
    return `${n} ETH`;
  }
  const symbol = fiatCurrencySymbol(displayCurrency as LegacyFiatCurrencyCode);
  const prefix = symbol.length === 1 ? symbol : `${symbol} `;
  if (n >= 1000 && n % 1000 === 0) {
    return `${prefix}${n / 1000}k`;
  }
  return `${prefix}${n.toLocaleString("en-US")}`;
}

export function priceFilterPlaceholder(displayCurrency: PriceCurrency): string {
  if (displayCurrency === "ETH") return "e.g. 4 ETH";
  const symbol = fiatCurrencySymbol(displayCurrency as LegacyFiatCurrencyCode);
  const prefix = symbol.length === 1 ? symbol : `${symbol} `;
  return `e.g. 15 000 ${prefix}`;
}

export function formatPriceChipLabel(
  priceMin: string,
  priceMax: string,
  displayCurrency: PriceCurrency = "USD",
): string {
  if (priceMin && priceMax) {
    const minN = Number.parseFloat(priceMin);
    const maxN = Number.parseFloat(priceMax);
    if (Number.isFinite(minN) && Number.isFinite(maxN) && minN >= 1000 && maxN >= 1000) {
      return `${formatCompactPrice(priceMin, displayCurrency)}–${formatCompactPrice(priceMax, displayCurrency)}`;
    }
    if (displayCurrency === "ETH") {
      return `${priceMin}–${priceMax} ETH`;
    }
    const symbol = fiatCurrencySymbol(displayCurrency as LegacyFiatCurrencyCode);
    const prefix = symbol.length === 1 ? symbol : `${symbol} `;
    return `${prefix}${Number(priceMin).toLocaleString("en-US")}–${prefix}${Number(priceMax).toLocaleString("en-US")}`;
  }
  if (priceMin) {
    if (displayCurrency === "ETH") return `From ${priceMin} ETH`;
    const symbol = fiatCurrencySymbol(displayCurrency as LegacyFiatCurrencyCode);
    const prefix = symbol.length === 1 ? symbol : `${symbol} `;
    return `From ${prefix}${Number(priceMin).toLocaleString("en-US")}`;
  }
  if (priceMax) {
    if (displayCurrency === "ETH") return `Up to ${priceMax} ETH`;
    const symbol = fiatCurrencySymbol(displayCurrency as LegacyFiatCurrencyCode);
    const prefix = symbol.length === 1 ? symbol : `${symbol} `;
    return `Up to ${prefix}${Number(priceMax).toLocaleString("en-US")}`;
  }
  return "";
}

export function formatYearChipLabel(yearMin: string, yearMax: string): string {
  if (yearMin && yearMax) return `${yearMin}–${yearMax}`;
  if (yearMin) return `From ${yearMin}`;
  if (yearMax) return `Up to ${yearMax}`;
  return "";
}

function formatKm(n: number): string {
  return n.toLocaleString("en-US");
}

export function formatMileageChipLabel(mileageMin: string, mileageMax: string): string {
  if (mileageMin && mileageMax) {
    return `${formatKm(Number.parseInt(mileageMin, 10))}–${formatKm(Number.parseInt(mileageMax, 10))} km`;
  }
  if (mileageMin) {
    return `From ${formatKm(Number.parseInt(mileageMin, 10))} km`;
  }
  if (mileageMax) {
    return `Up to ${formatKm(Number.parseInt(mileageMax, 10))} km`;
  }
  return "";
}

export function formatStatusChipLabel(status: VerificationFilter): string {
  if (status === "all") return "";
  return STATUS_LABELS[status];
}

export function formatMultiValueChipLabel(values: string[]): string {
  return values.join(" · ");
}

export type MarketApiRates = {
  eurUsdRate?: string;
  ethUsdRate?: string;
  cnyUsdRate?: string;
  inrUsdRate?: string;
  brlUsdRate?: string;
  idrUsdRate?: string;
  audUsdRate?: string;
};

function effectivePriceCurrency(filters: MarketFilterState): PriceCurrency {
  if (filters.priceCurrency) return filters.priceCurrency;
  if (filters.priceMin.trim() || filters.priceMax.trim()) return "USD";
  return "USD";
}

function shouldForwardRates(rates?: MarketApiRates): boolean {
  return rates != null;
}

export function marketFiltersToApiInput(
  filters: MarketFilterState,
  rates?: MarketApiRates,
) {
  const hasPriceBounds = Boolean(filters.priceMin.trim() || filters.priceMax.trim());
  const priceCurrency = hasPriceBounds ? effectivePriceCurrency(filters) : undefined;
  const forwardRates = shouldForwardRates(rates);

  return {
    search: filters.search.trim() || undefined,
    make: filters.make || undefined,
    model: filters.model || undefined,
    yearMin: filters.yearMin ? Number.parseInt(filters.yearMin, 10) : undefined,
    yearMax: filters.yearMax ? Number.parseInt(filters.yearMax, 10) : undefined,
    priceMin: filters.priceMin.trim() || undefined,
    priceMax: filters.priceMax.trim() || undefined,
    priceCurrency,
    eurUsdRate: forwardRates ? rates?.eurUsdRate : undefined,
    ethUsdRate: forwardRates ? rates?.ethUsdRate : undefined,
    cnyUsdRate: forwardRates ? rates?.cnyUsdRate : undefined,
    inrUsdRate: forwardRates ? rates?.inrUsdRate : undefined,
    brlUsdRate: forwardRates ? rates?.brlUsdRate : undefined,
    idrUsdRate: forwardRates ? rates?.idrUsdRate : undefined,
    audUsdRate: forwardRates ? rates?.audUsdRate : undefined,
    mileageMin: filters.mileageMin ? Number.parseInt(filters.mileageMin, 10) : undefined,
    mileageMax: filters.mileageMax ? Number.parseInt(filters.mileageMax, 10) : undefined,
    fuelType: filters.fuelTypes.length ? filters.fuelTypes.join(",") : undefined,
    bodyType: filters.bodyTypes.length ? filters.bodyTypes.join(",") : undefined,
    transmission: filters.transmissions.length ? filters.transmissions.join(",") : undefined,
    condition: filters.conditions.length ? filters.conditions.join(",") : undefined,
    vehicleType: filters.vehicleTypes.length ? filters.vehicleTypes.join(",") : undefined,
    location: filters.location.trim() || undefined,
    colour: filters.colour.trim() || undefined,
    status: filters.status,
    sort: filters.sort,
    page: filters.page,
    limit: 20,
  };
}

export type FilterChipKey =
  | "make"
  | "model"
  | "status"
  | "price"
  | "year"
  | "mileage"
  | "fuelTypes"
  | "bodyTypes"
  | "transmissions"
  | "conditions"
  | "vehicleTypes"
  | "location"
  | "colour";

export type FilterChip = {
  key: FilterChipKey;
  label: string;
};

export function getFilterChips(filters: MarketFilterState): FilterChip[] {
  const chips: FilterChip[] = [];

  if (filters.make) chips.push({ key: "make", label: filters.make });
  if (filters.model) chips.push({ key: "model", label: filters.model });
  if (filters.status !== "all") {
    chips.push({ key: "status", label: formatStatusChipLabel(filters.status) });
  }
  if (filters.priceMin || filters.priceMax) {
    chips.push({
      key: "price",
      label: formatPriceChipLabel(
        filters.priceMin,
        filters.priceMax,
        effectivePriceCurrency(filters),
      ),
    });
  }
  if (filters.yearMin || filters.yearMax) {
    chips.push({ key: "year", label: formatYearChipLabel(filters.yearMin, filters.yearMax) });
  }
  if (filters.mileageMin || filters.mileageMax) {
    chips.push({
      key: "mileage",
      label: formatMileageChipLabel(filters.mileageMin, filters.mileageMax),
    });
  }
  if (filters.fuelTypes.length) {
    chips.push({ key: "fuelTypes", label: formatMultiValueChipLabel(filters.fuelTypes) });
  }
  if (filters.bodyTypes.length) {
    chips.push({ key: "bodyTypes", label: formatMultiValueChipLabel(filters.bodyTypes) });
  }
  if (filters.transmissions.length) {
    chips.push({ key: "transmissions", label: formatMultiValueChipLabel(filters.transmissions) });
  }
  if (filters.conditions.length) {
    chips.push({ key: "conditions", label: formatMultiValueChipLabel(filters.conditions) });
  }
  if (filters.vehicleTypes.length) {
    chips.push({ key: "vehicleTypes", label: formatMultiValueChipLabel(filters.vehicleTypes) });
  }
  if (filters.location) chips.push({ key: "location", label: filters.location });
  if (filters.colour) chips.push({ key: "colour", label: filters.colour });

  return chips;
}

export function clearFilterChip(
  filters: MarketFilterState,
  key: FilterChipKey,
): MarketFilterState {
  switch (key) {
    case "make":
      return { ...filters, make: "", model: "", page: 1 };
    case "model":
      return { ...filters, model: "", page: 1 };
    case "status":
      return { ...filters, status: "all", page: 1 };
    case "price":
      return { ...filters, priceMin: "", priceMax: "", priceCurrency: "", page: 1 };
    case "year":
      return { ...filters, yearMin: "", yearMax: "", page: 1 };
    case "mileage":
      return { ...filters, mileageMin: "", mileageMax: "", page: 1 };
    case "fuelTypes":
      return { ...filters, fuelTypes: [], page: 1 };
    case "bodyTypes":
      return { ...filters, bodyTypes: [], page: 1 };
    case "transmissions":
      return { ...filters, transmissions: [], page: 1 };
    case "conditions":
      return { ...filters, conditions: [], page: 1 };
    case "vehicleTypes":
      return { ...filters, vehicleTypes: [], page: 1 };
    case "location":
      return { ...filters, location: "", page: 1 };
    case "colour":
      return { ...filters, colour: "", page: 1 };
    default:
      return filters;
  }
}
