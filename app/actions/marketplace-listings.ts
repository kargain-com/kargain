"use server";

import { z } from "zod";

import {
  filtersFromSearchParams,
  marketFiltersToApiInput,
} from "@/lib/marketplace/filter-params";

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
  updatedAtBlock: string;
  tokenUri: string;
  title: string;
  imageUrl: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  mileageKm: number | null;
  lat: number | null;
  lng: number | null;
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
  soldAt: string | number;
  buyer: string;
};

type PonderListingsResponse = {
  listings: PonderListing[];
  total: number;
  page: number;
  limit: number;
};

function mapListingToRow(listing: PonderListing): MarketplaceListingRow {
  return {
    chainId: BASE_SEPOLIA_CHAIN_ID,
    tokenId: listing.tokenId,
    seller: listing.seller as `0x${string}`,
    fiatPrice1e8: String(listing.fiatPrice1e8),
    fiatCurrency: listing.fiatCurrency,
    updatedAtBlock: String(listing.listedAt),
    tokenUri: "",
    title: `Vehicle #${listing.tokenId}`,
    imageUrl: null,
    make: null,
    model: null,
    year: null,
    mileageKm: null,
    lat: null,
    lng: null,
    karPro: false,
    featured: false,
  };
}

export async function searchMarketplaceListings(
  input: z.infer<typeof filterSchema>,
): Promise<MarketplaceListingsResult> {
  const p = filterSchema.parse(input);
  try {
    const url = new URL(`${PONDER_URL}/listings`);
    url.searchParams.set("page", p.page.toString());
    url.searchParams.set("limit", p.limit.toString());
    if (p.status !== "all") {
      url.searchParams.set("status", p.status);
    }
    const res = await fetch(url.toString(), { next: { revalidate: 30 } });
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
