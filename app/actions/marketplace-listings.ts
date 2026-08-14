"use server";

import { getConsignments } from "@/app/actions/commerce-consignments";
import { z } from "zod";

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
import {
  buildConsignmentsListUrl,
  buildPassportListUrl,
  buildPonderUrl,
  fetchConsignmentByToken,
  fetchPassportByToken,
  ponderFetch,
} from "@/lib/web3/ponder-fetch";

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
  statusCounts?: {
    UNVERIFIED?: number;
    VERIFIED?: number;
    DISPUTED?: number;
  };
};

/** Marketplace browse — sends all catalog filter/sort/FX keys the handler reads. */
function buildMarketplaceBrowseUrl(p: z.infer<typeof filterSchema>): URL {
  return buildConsignmentsListUrl({
    mode: "fixedPrice",
    active: true,
    page: p.page,
    limit: p.limit,
    search: p.search,
    make: p.make,
    model: p.model,
    yearMin: p.yearMin,
    yearMax: p.yearMax,
    mileageMin: p.mileageMin,
    mileageMax: p.mileageMax,
    priceMin: p.priceMin,
    priceMax: p.priceMax,
    priceCurrency: p.priceCurrency,
    eurUsdRate: p.eurUsdRate,
    ethUsdRate: p.ethUsdRate,
    cnyUsdRate: p.cnyUsdRate,
    inrUsdRate: p.inrUsdRate,
    brlUsdRate: p.brlUsdRate,
    idrUsdRate: p.idrUsdRate,
    audUsdRate: p.audUsdRate,
    aedUsdRate: p.aedUsdRate,
    krwUsdRate: p.krwUsdRate,
    rubUsdRate: p.rubUsdRate,
    jpyUsdRate: p.jpyUsdRate,
    btcUsdRate: p.btcUsdRate,
    fuelType: p.fuelType,
    bodyType: p.bodyType,
    transmission: p.transmission,
    condition: p.condition,
    vehicleType: p.vehicleType,
    placeId: p.placeId,
    colour: p.colour,
    status: p.status === "all" ? undefined : p.status,
    sort: p.sort,
  });
}

export async function searchMarketplaceListings(
  input: z.infer<typeof filterSchema>,
): Promise<MarketplaceListingsResult> {
  const p = filterSchema.parse(input);
  try {
    const res = await ponderFetch(
      "marketplace-listings",
      buildMarketplaceBrowseUrl(p).toString(),
    );
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
    const data = res.body as ConsignmentsResponse;
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
    const res = await fetchPassportByToken(tokenId);
    if (!res.ok) return null;
    return res.body;
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
      ponderFetch(
        "profile-passports",
        buildPonderUrl("profile.passports", { address }).toString(),
      ),
      getConsignments({ seller: address, live: true, limit: 100 }),
    ]);

    const passports = passportsRes.ok
      ? (passportsRes.body as { passports: unknown[] }).passports
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
    const res = await ponderFetch(
      "passports",
      buildPassportListUrl({
        verifier: address,
        status: "VERIFIED",
        limit: 100,
      }).toString(),
    );
    if (!res.ok) return [];
    const data = res.body as { passports: Array<Record<string, unknown>> };
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

export async function loadFavoriteListingCards(tokenIds: string[]) {
  const rows = await Promise.all(
    tokenIds.map(async (tokenId) => {
      try {
        const lot = await fetchConsignmentByToken(tokenId, { mode: "fixedPrice" });
        if (!lot.ok || lot.consignment == null) return null;
        const row = lot.consignment;
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
