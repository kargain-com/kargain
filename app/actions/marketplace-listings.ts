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
    lat: null,
    lng: null,
    duplicateVin: listing.duplicateVin === true,
    karPro: false,
    featured: status === "VERIFIED",
  };
}

function applyClientFilters(
  rows: MarketplaceListingRow[],
  p: z.infer<typeof filterSchema>,
): MarketplaceListingRow[] {
  return rows.filter((row) => {
    if (p.make && row.make?.toLowerCase() !== p.make.toLowerCase()) return false;
    if (p.model && row.model?.toLowerCase() !== p.model.toLowerCase()) return false;
    if (p.yearMin != null && (row.year ?? 0) < p.yearMin) return false;
    if (p.yearMax != null && (row.year ?? 0) > p.yearMax) return false;
    if (p.mileageMax != null && (row.mileageKm ?? 0) > p.mileageMax) return false;
    return true;
  });
}

function applyClientSort(
  rows: MarketplaceListingRow[],
  sort: z.infer<typeof filterSchema>["sort"],
): MarketplaceListingRow[] {
  const copy = [...rows];
  switch (sort) {
    case "price_asc":
      return copy.sort(
        (a, b) => Number(a.fiatPrice1e8) - Number(b.fiatPrice1e8),
      );
    case "price_desc":
      return copy.sort(
        (a, b) => Number(b.fiatPrice1e8) - Number(a.fiatPrice1e8),
      );
    case "mileage_asc":
      return copy.sort((a, b) => (a.mileageKm ?? 0) - (b.mileageKm ?? 0));
    default:
      return copy;
  }
}

export async function searchMarketplaceListings(
  input: z.infer<typeof filterSchema>,
): Promise<MarketplaceListingsResult> {
  const p = filterSchema.parse(input);
  try {
    const url = new URL(`${PONDER_URL}/listings`);
    url.searchParams.set("page", "1");
    url.searchParams.set("limit", "100");
    url.searchParams.set("verifiedFirst", "true");
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
    let rows = data.listings.map(mapListingToRow);
    rows = applyClientFilters(rows, p);
    rows = applyClientSort(rows, p.sort);
    const total = rows.length;
    const offset = (p.page - 1) * p.limit;
    const pageRows = rows.slice(offset, offset + p.limit);
    const totalPages = total > 0 ? Math.ceil(total / p.limit) : 0;
    return {
      ok: true,
      rows: pageRows,
      total,
      page: p.page,
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
