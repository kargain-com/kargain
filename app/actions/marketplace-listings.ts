"use server";

import { z } from "zod";

import {
  filtersFromSearchParams,
  marketFiltersToApiInput,
} from "@/lib/marketplace/filter-params";
import { arUriToHttp } from "@/lib/passport/index-passport-metadata";
import type { PassportStatus } from "@/lib/types/ponder";

const filterSchema = z.object({
  make: z.string().optional(),
  model: z.string().optional(),
  yearMin: z.number().int().optional(),
  yearMax: z.number().int().optional(),
  priceMin: z.string().optional(),
  priceMax: z.string().optional(),
  mileageMax: z.number().int().optional(),
  fuelType: z.string().optional(),
  bodyType: z.string().optional(),
  transmission: z.string().optional(),
  status: z.enum(["all", "UNVERIFIED", "VERIFIED", "DISPUTED"]).default("all"),
  sort: z.enum(["newest", "price_asc", "price_desc", "mileage_asc"]).default("newest"),
  currency: z.enum(["USD", "EUR"]).default("USD"),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(48).default(20),
});

export type MarketplaceListingRow = {
  chainId: number;
  tokenId: string;
  seller: `0x${string}`;
  fiatPrice1e8: string;
  fiatCurrency: number;
  passportStatus: PassportStatus;
  updatedAtBlock: string;
  tokenUri: string;
  title: string;
  imageUrl: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  mileageKm: number | null;
  fuelType: string | null;
  bodyType: string | null;
  transmission: string | null;
  lat: number | null;
  lng: number | null;
  duplicateVin: boolean;
  karPro: boolean;
  featured: boolean;
};

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

const BASE_SEPOLIA_CHAIN_ID = 84532;

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
  duplicateVin?: boolean;
};

type PonderListingsResponse = {
  listings: PonderListing[];
  total: number;
  page: number;
  limit: number;
};

function buildTitle(listing: PonderListing): string {
  if (listing.year && listing.make && listing.model) {
    return `${listing.year} ${listing.make} ${listing.model}`;
  }
  if (listing.make && listing.model) return `${listing.make} ${listing.model}`;
  return `Vehicle #${listing.tokenId}`;
}

function photoFromUri(tokenUri: string | undefined): string | null {
  if (!tokenUri?.startsWith("ar://")) return null;
  return arUriToHttp(tokenUri);
}

function mapListingToRow(listing: PonderListing): MarketplaceListingRow {
  const status = (listing.passportStatus ?? "UNVERIFIED") as PassportStatus;
  return {
    chainId: BASE_SEPOLIA_CHAIN_ID,
    tokenId: listing.tokenId,
    seller: listing.seller as `0x${string}`,
    fiatPrice1e8: String(listing.fiatPrice1e8),
    fiatCurrency: listing.fiatCurrency,
    passportStatus: status,
    updatedAtBlock: String(listing.listedAt),
    tokenUri: listing.tokenUri ?? "",
    title: buildTitle(listing),
    imageUrl: photoFromUri(listing.tokenUri),
    make: listing.make || null,
    model: listing.model || null,
    year: listing.year && listing.year > 0 ? listing.year : null,
    mileageKm: listing.mileageKm && listing.mileageKm > 0 ? listing.mileageKm : null,
    fuelType: listing.fuelType || null,
    bodyType: listing.bodyType || null,
    transmission: listing.transmission || null,
    lat: null,
    lng: null,
    duplicateVin: listing.duplicateVin === true,
    karPro: false,
    featured: status === "VERIFIED",
  };
}

function buildPonderListingsUrl(p: z.infer<typeof filterSchema>): URL {
  const url = new URL(`${PONDER_URL}/listings`);
  url.searchParams.set("page", String(p.page));
  url.searchParams.set("limit", String(p.limit));
  url.searchParams.set("verifiedFirst", "true");
  url.searchParams.set("currency", p.currency);
  if (p.make) url.searchParams.set("make", p.make);
  if (p.model) url.searchParams.set("model", p.model);
  if (p.yearMin != null) url.searchParams.set("yearMin", String(p.yearMin));
  if (p.yearMax != null) url.searchParams.set("yearMax", String(p.yearMax));
  if (p.mileageMax != null) url.searchParams.set("mileageMax", String(p.mileageMax));
  if (p.priceMin) url.searchParams.set("priceMin", p.priceMin);
  if (p.priceMax) url.searchParams.set("priceMax", p.priceMax);
  if (p.fuelType) url.searchParams.set("fuelType", p.fuelType);
  if (p.bodyType) url.searchParams.set("bodyType", p.bodyType);
  if (p.transmission) url.searchParams.set("transmission", p.transmission);
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
    const rows = data.listings.map(mapListingToRow);
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
  const rows: MarketplaceListingRow[] = [];
  for (const tokenId of tokenIds) {
    try {
      const res = await fetch(`${PONDER_URL}/listings/${tokenId}`, {
        next: { revalidate: 30 },
      });
      if (!res.ok) continue;
      const listing = (await res.json()) as PonderListing;
      if (listing.active) rows.push(mapListingToRow(listing));
    } catch {
      /* skip */
    }
  }
  return rows;
}
