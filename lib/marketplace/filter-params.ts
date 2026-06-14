export type MarketSort = "newest" | "price_asc" | "price_desc" | "mileage_asc";
export type VerificationFilter = "all" | "VERIFIED" | "UNVERIFIED" | "DISPUTED";

export type MarketFilterState = {
  make: string;
  model: string;
  yearMin: string;
  yearMax: string;
  priceMin: string;
  priceMax: string;
  mileageMax: string;
  fuelTypes: string[];
  bodyTypes: string[];
  transmissions: string[];
  status: VerificationFilter;
  sort: MarketSort;
  currency: "USD" | "EUR";
  page: number;
};

export const DEFAULT_MARKET_FILTERS: MarketFilterState = {
  make: "",
  model: "",
  yearMin: "",
  yearMax: "",
  priceMin: "",
  priceMax: "",
  mileageMax: "",
  fuelTypes: [],
  bodyTypes: [],
  transmissions: [],
  status: "all",
  sort: "newest",
  currency: "USD",
  page: 1,
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
  const currencyRaw = sp.get("currency");
  const currency = currencyRaw === "EUR" ? "EUR" : "USD";
  const pageRaw = sp.get("page");
  const pageN = pageRaw ? Number.parseInt(pageRaw, 10) : 1;

  return {
    make: sp.get("make") ?? "",
    model: sp.get("model") ?? "",
    yearMin: sp.get("yearMin") ?? "",
    yearMax: sp.get("yearMax") ?? "",
    priceMin: sp.get("priceMin") ?? "",
    priceMax: sp.get("priceMax") ?? "",
    mileageMax: sp.get("mileageMax") ?? "",
    fuelTypes: splitCsv(sp.get("fuelType")),
    bodyTypes: splitCsv(sp.get("bodyType")),
    transmissions: splitCsv(sp.get("transmission")),
    status,
    sort,
    currency,
    page: Number.isFinite(pageN) && pageN >= 1 ? pageN : 1,
  };
}

export function filtersToSearchParams(filters: MarketFilterState): URLSearchParams {
  const sp = new URLSearchParams();
  if (filters.make) sp.set("make", filters.make);
  if (filters.model) sp.set("model", filters.model);
  if (filters.yearMin) sp.set("yearMin", filters.yearMin);
  if (filters.yearMax) sp.set("yearMax", filters.yearMax);
  if (filters.priceMin) sp.set("priceMin", filters.priceMin);
  if (filters.priceMax) sp.set("priceMax", filters.priceMax);
  if (filters.mileageMax) sp.set("mileageMax", filters.mileageMax);
  if (filters.fuelTypes.length) sp.set("fuelType", filters.fuelTypes.join(","));
  if (filters.bodyTypes.length) sp.set("bodyType", filters.bodyTypes.join(","));
  if (filters.transmissions.length) sp.set("transmission", filters.transmissions.join(","));
  if (filters.status !== "all") sp.set("status", filters.status);
  if (filters.sort !== "newest") sp.set("sort", filters.sort);
  if (filters.currency !== "USD") sp.set("currency", filters.currency);
  if (filters.page > 1) sp.set("page", String(filters.page));
  return sp;
}

export function countActiveFilters(filters: MarketFilterState): number {
  let n = 0;
  if (filters.make) n++;
  if (filters.model) n++;
  if (filters.yearMin || filters.yearMax) n++;
  if (filters.priceMin || filters.priceMax) n++;
  if (filters.mileageMax) n++;
  if (filters.fuelTypes.length) n++;
  if (filters.bodyTypes.length) n++;
  if (filters.transmissions.length) n++;
  if (filters.status !== "all") n++;
  return n;
}

/** Convert display currency amounts to on-chain 1e8 units. */
export function priceToFiat1e8(amount: string): string | undefined {
  const trimmed = amount.trim();
  if (!trimmed) return undefined;
  const n = Number.parseFloat(trimmed);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return BigInt(Math.round(n * 100_000_000)).toString();
}

export function marketFiltersToApiInput(filters: MarketFilterState) {
  return {
    make: filters.make || undefined,
    model: filters.model || undefined,
    yearMin: filters.yearMin ? Number.parseInt(filters.yearMin, 10) : undefined,
    yearMax: filters.yearMax ? Number.parseInt(filters.yearMax, 10) : undefined,
    priceMin: priceToFiat1e8(filters.priceMin),
    priceMax: priceToFiat1e8(filters.priceMax),
    mileageMax: filters.mileageMax ? Number.parseInt(filters.mileageMax, 10) : undefined,
    fuelType: filters.fuelTypes.length ? filters.fuelTypes.join(",") : undefined,
    bodyType: filters.bodyTypes.length ? filters.bodyTypes.join(",") : undefined,
    transmission: filters.transmissions.length ? filters.transmissions.join(",") : undefined,
    status: filters.status,
    sort: filters.sort,
    currency: filters.currency,
    page: filters.page,
    limit: 20,
  };
}
