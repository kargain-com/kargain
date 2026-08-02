"use server";

import { getConsignments } from "@/app/actions/commerce-consignments";
import { z } from "zod";
import { ponderBaseUrl, ponderFetch } from "@/lib/web3/ponder-fetch";

import { DISPLAY_CURRENCIES } from "@/lib/marketplace/currency-code";
import {
  filtersFromSearchParams,
  marketFiltersToApiInput,
} from "@/lib/marketplace/filter-params";
import { consignmentToListingInput } from "@/lib/commerce/listing-view";
import type { PonderConsignmentRow } from "@/lib/commerce/ponder-consignment";
import {
  mapPonderListingToRow,
  type MarketplaceListingRow as MarketplaceListingRowType,
} from "@/lib/marketplace/map-ponder-listing";
import {
  mapProfileListingFromConsignment,
  mapProfilePassport,
  type ProfileListingRow,
  type ProfilePassportRow,
} from "@/lib/passport/map-profile-passport";
import type { PassportStatus } from "@/lib/types/ponder";

export type MarketplaceListingRow = MarketplaceListingRowType;

const filterSchema = z.object({
  search: z.string().optional(),
  make: z.string().optional(),
  model: z.string().optional(),
  yearMin: z.number().int().optional(),
  yearMax: z.number().int().optional(),
  priceMin: z.string().optional(),
  priceMax: z.string().optional(),
  priceCurrency: z.enum(DISPLAY_CURRENCIES as unknown as [string, ...string[]]).optional(),
  eurUsdRate: z.string().optional(),
  ethUsdRate: z.string().optional(),
  cnyUsdRate: z.string().optional(),
  inrUsdRate: z.string().optional(),
  brlUsdRate: z.string().optional(),
  idrUsdRate: z.string().optional(),
  audUsdRate: z.string().optional(),
  aedUsdRate: z.string().optional(),
  krwUsdRate: z.string().optional(),
  rubUsdRate: z.string().optional(),
  jpyUsdRate: z.string().optional(),
  btcUsdRate: z.string().optional(),
  mileageMin: z.number().int().optional(),
  mileageMax: z.number().int().optional(),
  fuelType: z.string().optional(),
  bodyType: z.string().optional(),
  transmission: z.string().optional(),
  condition: z.string().optional(),
  vehicleType: z.string().optional(),
  placeId: z.string().optional(),
  colour: z.string().optional(),
  status: z.enum(["all", "UNVERIFIED", "VERIFIED", "DISPUTED"]).default("all"),
  sort: z.enum(["newest", "price_asc", "price_desc", "mileage_asc"]).default("newest"),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(48).default(20),
});

export type MarketplaceListingsResult = {
  ok: true;
  rows: MarketplaceListingRow[];
  total: number;
  page: number;
  totalPages: number;
  ponderError?: string;
};


type ConsignmentsResponse = {
  consignments?: PonderConsignmentRow[];
  total?: number;
  page?: number;
  limit?: number;
};

function buildPonderListingsUrl(p: z.infer<typeof filterSchema>): URL {
  const url = new URL(`${ponderBaseUrl()}/consignments`);
  url.searchParams.set("mode", "fixedPrice");
  url.searchParams.set("active", "true");
  url.searchParams.set("page", String(p.page));
  url.searchParams.set("limit", String(p.limit));
  url.searchParams.set("verifiedFirst", "true");
  if (p.search) url.searchParams.set("search", p.search);
  if (p.make) url.searchParams.set("make", p.make);
  if (p.model) url.searchParams.set("model", p.model);
  if (p.yearMin != null) url.searchParams.set("yearMin", String(p.yearMin));
  if (p.yearMax != null) url.searchParams.set("yearMax", String(p.yearMax));
  if (p.mileageMin != null) url.searchParams.set("mileageMin", String(p.mileageMin));
  if (p.mileageMax != null) url.searchParams.set("mileageMax", String(p.mileageMax));
  if (p.priceMin) url.searchParams.set("priceMin", p.priceMin);
  if (p.priceMax) url.searchParams.set("priceMax", p.priceMax);
  if (p.priceCurrency) url.searchParams.set("priceCurrency", p.priceCurrency);
  if (p.eurUsdRate) url.searchParams.set("eurUsdRate", p.eurUsdRate);
  if (p.ethUsdRate) url.searchParams.set("ethUsdRate", p.ethUsdRate);
  if (p.cnyUsdRate) url.searchParams.set("cnyUsdRate", p.cnyUsdRate);
  if (p.inrUsdRate) url.searchParams.set("inrUsdRate", p.inrUsdRate);
  if (p.brlUsdRate) url.searchParams.set("brlUsdRate", p.brlUsdRate);
  if (p.idrUsdRate) url.searchParams.set("idrUsdRate", p.idrUsdRate);
  if (p.audUsdRate) url.searchParams.set("audUsdRate", p.audUsdRate);
  if (p.aedUsdRate) url.searchParams.set("aedUsdRate", p.aedUsdRate);
  if (p.krwUsdRate) url.searchParams.set("krwUsdRate", p.krwUsdRate);
  if (p.rubUsdRate) url.searchParams.set("rubUsdRate", p.rubUsdRate);
  if (p.jpyUsdRate) url.searchParams.set("jpyUsdRate", p.jpyUsdRate);
  if (p.btcUsdRate) url.searchParams.set("btcUsdRate", p.btcUsdRate);
  if (p.fuelType) url.searchParams.set("fuelType", p.fuelType);
  if (p.bodyType) url.searchParams.set("bodyType", p.bodyType);
  if (p.transmission) url.searchParams.set("transmission", p.transmission);
  if (p.condition) url.searchParams.set("condition", p.condition);
  if (p.vehicleType) url.searchParams.set("vehicleType", p.vehicleType);
  if (p.placeId) url.searchParams.set("placeId", p.placeId);
  if (p.colour) url.searchParams.set("colour", p.colour);
  if (p.status !== "all") url.searchParams.set("status", p.status);
  if (p.sort !== "newest") url.searchParams.set("sort", p.sort);
  return url;
}

export async function searchMarketplaceListings(
  input: z.infer<typeof filterSchema>,
): Promise<MarketplaceListingsResult> {
  const p = filterSchema.parse(input);
  try {
    const res = await ponderFetch(buildPonderListingsUrl(p).toString());
    if (!res.ok) {
      return {
        ok: true,
        rows: [],
        total: 0,
        page: p.page,
        totalPages: 0,
        ponderError: "PONDER_UNAVAILABLE",
      };
    }
    const data = (await res.json()) as ConsignmentsResponse;
    const rows = (data.consignments ?? []).map((row) =>
      mapPonderListingToRow(consignmentToListingInput(row)),
    );
    const total = data.total ?? rows.length;
    return {
      ok: true,
      rows,
      total,
      page: data.page ?? p.page,
      totalPages: total > 0 ? Math.ceil(total / p.limit) : 0,
    };
  } catch {
    return {
      ok: true,
      rows: [],
      total: 0,
      page: p.page,
      totalPages: 0,
      ponderError: "PONDER_UNAVAILABLE",
    };
  }
}

export async function searchMarketplaceFromUrlQuery(
  queryString: string,
): Promise<MarketplaceListingsResult> {
  const filters = filtersFromSearchParams(new URLSearchParams(queryString));
  return searchMarketplaceListings(marketFiltersToApiInput(filters));
}

export async function getPassportFromPonder(tokenId: string) {
  try {
    const res = await ponderFetch(`${ponderBaseUrl()}/passports/${tokenId}`);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function getProfileData(address: string): Promise<{
  passports: ProfilePassportRow[];
  listings: ProfileListingRow[];
}> {
  try {
    const [passportsRes, consignmentsPage] = await Promise.all([
      ponderFetch(`${ponderBaseUrl()}/profile/${address}/passports`),
      // Seller live lots (offered|binding) — same filter as marketplace browse.
      getConsignments({ seller: address, live: true, limit: 100 }),
    ]);

    const passports = passportsRes.ok
      ? ((await passportsRes.json()) as { passports: unknown[] }).passports
          .map(mapProfilePassport)
          .filter((p): p is ProfilePassportRow => p != null)
      : [];

    const listings = consignmentsPage.ponderError
      ? []
      : consignmentsPage.rows
          .map(mapProfileListingFromConsignment)
          .filter((l): l is ProfileListingRow => l != null);

    return { passports, listings };
  } catch {
    return { passports: [], listings: [] };
  }
}

export type VerifierPassportRow = {
  tokenId: string;
  status: PassportStatus;
  make: string;
  model: string;
  year: number;
};

export async function getPassportsByVerifier(
  address: string,
): Promise<VerifierPassportRow[]> {
  try {
    const url = new URL(`${ponderBaseUrl()}/passports`);
    url.searchParams.set("verifier", address);
    url.searchParams.set("status", "VERIFIED");
    url.searchParams.set("limit", "100");
    const res = await ponderFetch(url.toString());
    if (!res.ok) return [];
    const data = (await res.json()) as { passports: Array<Record<string, unknown>> };
    return (data.passports ?? []).map((p) => ({
      tokenId: String(p.id ?? ""),
      status: (p.status as PassportStatus) ?? "UNVERIFIED",
      make: typeof p.make === "string" ? p.make : "",
      model: typeof p.model === "string" ? p.model : "",
      year: typeof p.year === "number" ? p.year : Number(p.year ?? 0),
    }));
  } catch {
    return [];
  }
}

export async function fetchMarketplaceStats() {
  try {
    const res = await ponderFetch(`${ponderBaseUrl()}/consignments/stats`);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function fetchListingFacets() {
  try {
    const res = await ponderFetch(`${ponderBaseUrl()}/consignments/facets`);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function loadFavoriteListingCards(tokenIds: string[]) {
  const rows = await Promise.all(
    tokenIds.map(async (tokenId) => {
      try {
        const url = new URL(`${ponderBaseUrl()}/consignments/${tokenId}`);
        url.searchParams.set("mode", "fixedPrice");
        const res = await ponderFetch(url.toString());
        if (!res.ok) return null;
        const row = (await res.json()) as PonderConsignmentRow;
        const input = consignmentToListingInput(row);
        if (!input.active) return null;
        return mapPonderListingToRow(input);
      } catch {
        return null;
      }
    }),
  );
  return rows.filter((row): row is MarketplaceListingRow => row != null);
}
