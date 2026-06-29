"use server";

import { z } from "zod";

import {
  filtersFromSearchParams,
  marketFiltersToApiInput,
} from "@/lib/marketplace/filter-params";
import {
  mapPonderListingToRow,
  type MarketplaceListingRow as MarketplaceListingRowType,
} from "@/lib/marketplace/map-ponder-listing";
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
  priceCurrency: z.enum(["USD", "EUR", "ETH"]).optional(),
  eurUsdRate: z.string().optional(),
  ethUsdRate: z.string().optional(),
  mileageMin: z.number().int().optional(),
  mileageMax: z.number().int().optional(),
  fuelType: z.string().optional(),
  bodyType: z.string().optional(),
  transmission: z.string().optional(),
  condition: z.string().optional(),
  vehicleType: z.string().optional(),
  location: z.string().optional(),
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

const PONDER_URL =
  process.env.PONDER_SQL_API_URL ?? "http://localhost:42069";

type PonderListing = {
  id: string;
  tokenId: string;
  seller: string;
  fiatPrice1e8: string | number;
  fiatCurrency: number;
  active: boolean;
  listedAt: string | number;
  passportStatus?: string;
  make?: string;
  model?: string;
  year?: number;
  mileageKm?: number;
  fuelType?: string;
  bodyType?: string;
  transmission?: string;
  tokenUri?: string;
  coverPhotoUri?: string;
  duplicateVin?: boolean;
  verifier?: string;
};

type PonderListingsResponse = {
  listings: PonderListing[];
  total: number;
  page: number;
  limit: number;
};

function buildPonderListingsUrl(p: z.infer<typeof filterSchema>): URL {
  const url = new URL(`${PONDER_URL}/listings`);
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
  if (p.fuelType) url.searchParams.set("fuelType", p.fuelType);
  if (p.bodyType) url.searchParams.set("bodyType", p.bodyType);
  if (p.transmission) url.searchParams.set("transmission", p.transmission);
  if (p.condition) url.searchParams.set("condition", p.condition);
  if (p.vehicleType) url.searchParams.set("vehicleType", p.vehicleType);
  if (p.location) url.searchParams.set("location", p.location);
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
    const res = await fetch(buildPonderListingsUrl(p).toString(), {
      next: { revalidate: 30 },
    });
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
    const data = (await res.json()) as PonderListingsResponse;
    const rows = data.listings.map(mapPonderListingToRow);
    const totalPages = data.total > 0 ? Math.ceil(data.total / p.limit) : 0;
    return {
      ok: true,
      rows,
      total: data.total,
      page: data.page,
      totalPages,
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
    const res = await fetch(`${PONDER_URL}/passports/${tokenId}`, {
      next: { revalidate: 10 },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function getProfileData(address: string) {
  try {
    const [passportsRes, listingsRes] = await Promise.all([
      fetch(`${PONDER_URL}/profile/${address}/passports`, {
        next: { revalidate: 30 },
      }),
      fetch(`${PONDER_URL}/profile/${address}/listings`, {
        next: { revalidate: 30 },
      }),
    ]);
    return {
      passports: passportsRes.ok
        ? ((await passportsRes.json()) as { passports: unknown[] }).passports
        : [],
      listings: listingsRes.ok
        ? ((await listingsRes.json()) as { listings: unknown[] }).listings
        : [],
    };
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
    const url = new URL(`${PONDER_URL}/passports`);
    url.searchParams.set("verifier", address);
    url.searchParams.set("status", "VERIFIED");
    url.searchParams.set("limit", "100");
    const res = await fetch(url.toString(), { next: { revalidate: 30 } });
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
    const res = await fetch(`${PONDER_URL}/listings/stats`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function fetchListingFacets() {
  try {
    const res = await fetch(`${PONDER_URL}/listings/facets`, {
      next: { revalidate: 60 },
    });
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
        const res = await fetch(`${PONDER_URL}/listings/${tokenId}`, {
          next: { revalidate: 30 },
        });
        if (!res.ok) return null;
        const listing = (await res.json()) as PonderListing;
        if (!listing.active) return null;
        return mapPonderListingToRow(listing);
      } catch {
        return null;
      }
    }),
  );
  return rows.filter((row): row is MarketplaceListingRow => row != null);
}
