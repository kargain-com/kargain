import { db } from "ponder:api";
import {
  marketplaceListing,
  passport,
  passportRecord,
  passportUriHistory,
  verifier,
} from "ponder:schema";
import {
  and,
  count,
  desc,
  eq,
  inArray,
  replaceBigInts,
  sql,
} from "ponder";
import { Hono } from "hono";
import { getAddress } from "viem";

import {
  computeListingFacets,
  matchesListingFilters,
  parseListingFilterQuery,
  isDefaultListingsBrowse,
  sortEnrichedListings,
  type EnrichedListingForFilter,
  type ListingFilterQuery,
} from "../../lib/marketplace/listing-query";
import { parseFxRates } from "../../lib/marketplace/price-normalize";
import {
  SLUG_MAX_LENGTH,
  SLUG_MIN_LENGTH,
  SLUG_PATTERN,
} from "../../lib/kar-pro/kar-pro-metadata";
import { buildNotificationFeed } from "./notifications-query";
import { legacyFiatFromCurrencyCode } from "../../lib/marketplace/currency-code";

const app = new Hono();

const STATUS_ORDER = sql`CASE ${passport.status}
  WHEN 'VERIFIED' THEN 0
  WHEN 'UNVERIFIED' THEN 1
  WHEN 'DISPUTED' THEN 2
  ELSE 3 END`;

function parsePage(raw: string | undefined): number {
  const n = raw ? Number.parseInt(raw, 10) : 1;
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

function parseLimit(raw: string | undefined): number {
  const n = raw ? Number.parseInt(raw, 10) : 20;
  if (!Number.isFinite(n) || n < 1) return 20;
  return Math.min(n, 100);
}

function parseOffset(raw: string | undefined): number {
  const n = raw ? Number.parseInt(raw, 10) : 0;
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function parseIdList(raw: string | undefined, max = 50): string[] {
  if (!raw?.trim()) return [];
  return [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))].slice(0, max);
}

const ATTESTATION_RECORD_TYPE = "attestation";

function jsonBody<T>(value: T): T {
  return replaceBigInts(value, (v) => String(v)) as T;
}

type PassportDenorm = {
  status: string;
  verifier: string;
  vin: string;
  make: string;
  model: string;
  year: number;
  mileageKm: number;
  fuelType: string;
  bodyType: string;
  transmission: string;
  condition: string;
  vehicleType: string;
  colour: string;
  locationLabel: string;
  tokenUri: string;
  coverPhotoUri: string;
  duplicateVin: boolean;
};

async function loadPassportMap(
  tokenIds: string[],
): Promise<Map<string, PassportDenorm>> {
  const map = new Map<string, PassportDenorm>();
  if (tokenIds.length === 0) return map;

  const chunkSize = 500;
  for (let i = 0; i < tokenIds.length; i += chunkSize) {
    const chunk = tokenIds.slice(i, i + chunkSize);
    const rows = await db
      .select()
      .from(passport)
      .where(inArray(passport.id, chunk));
    for (const row of rows) {
      map.set(row.id, {
        status: row.status,
        verifier: row.verifier,
        vin: row.vin,
        make: row.make,
        model: row.model,
        year: row.year,
        mileageKm: row.mileageKm,
        fuelType: row.fuelType,
        bodyType: row.bodyType,
        transmission: row.transmission,
        condition: row.condition,
        vehicleType: row.vehicleType,
        colour: row.colour,
        locationLabel: row.locationLabel,
        tokenUri: row.tokenUri,
        coverPhotoUri: row.coverPhotoUri,
        duplicateVin: row.duplicateVin,
      });
    }
  }
  return map;
}

function withLegacyFiatCurrency<T extends { currencyCode: string }>(
  row: T,
): T & { fiatCurrency: 0 | 1 } {
  return {
    ...row,
    fiatCurrency: legacyFiatFromCurrencyCode(row.currencyCode),
  };
}

async function loadActiveListingFacetRows(): Promise<EnrichedListingForFilter[]> {
  const rows = await db
    .select({
      fiatPrice1e8: marketplaceListing.fiatPrice1e8,
      currencyCode: marketplaceListing.currencyCode,
      listedAt: marketplaceListing.listedAt,
      make: passport.make,
      model: passport.model,
      year: passport.year,
      mileageKm: passport.mileageKm,
      fuelType: passport.fuelType,
      bodyType: passport.bodyType,
      transmission: passport.transmission,
      condition: passport.condition,
      vehicleType: passport.vehicleType,
      passportStatus: passport.status,
    })
    .from(marketplaceListing)
    .leftJoin(passport, eq(marketplaceListing.tokenId, passport.id))
    .where(eq(marketplaceListing.active, true));

  return rows.map((row) => ({
    fiatPrice1e8: row.fiatPrice1e8,
    fiatCurrency: legacyFiatFromCurrencyCode(row.currencyCode),
    listedAt: row.listedAt,
    passportStatus: row.passportStatus ?? "UNVERIFIED",
    vin: "",
    make: row.make ?? "",
    model: row.model ?? "",
    year: row.year ?? 0,
    mileageKm: row.mileageKm ?? 0,
    fuelType: row.fuelType ?? "",
    bodyType: row.bodyType ?? "",
    transmission: row.transmission ?? "",
    condition: row.condition ?? "",
    vehicleType: row.vehicleType ?? "",
    colour: "",
    locationLabel: "",
  }));
}

function enrichListing(
  listing: {
    id: string;
    tokenId: string;
    seller: string;
    fiatPrice1e8: bigint;
    currencyCode: string;
    agent: string;
    agentFeeBps: number;
    ownerMinPrice1e8: bigint;
    active: boolean;
    listedAt: bigint;
    soldAt: bigint;
    buyer: string;
  },
  passportMap: Map<string, PassportDenorm>,
) {
  const p = passportMap.get(listing.tokenId);
  const passportStatus = p?.status ?? "UNVERIFIED";
  return {
    ...withLegacyFiatCurrency(listing),
    make: p?.make ?? "",
    model: p?.model ?? "",
    year: p?.year ?? 0,
    mileageKm: p?.mileageKm ?? 0,
    fuelType: p?.fuelType ?? "",
    bodyType: p?.bodyType ?? "",
    transmission: p?.transmission ?? "",
    condition: p?.condition ?? "",
    vehicleType: p?.vehicleType ?? "",
    colour: p?.colour ?? "",
    locationLabel: p?.locationLabel ?? "",
    passportStatus,
    verifier: p?.verifier ?? "",
    vin: p?.vin ?? "",
    tokenUri: p?.tokenUri ?? "",
    coverPhotoUri: p?.coverPhotoUri ?? "",
    duplicateVin: p?.duplicateVin ?? false,
  };
}

function filterAndSortListings(
  listings: Array<EnrichedListingForFilter & Record<string, unknown>>,
  filters: ListingFilterQuery,
  verifiedFirst: boolean,
) {
  const rates = parseFxRates(filters.eurUsdRate, filters.ethUsdRate);
  const filtered = listings.filter((row) => matchesListingFilters(row, filters));
  return sortEnrichedListings(filtered, filters.sort ?? "newest", verifiedFirst, rates);
}

async function loadDefaultBrowsePage(
  limit: number,
  offset: number,
  verifiedFirst: boolean,
) {
  const orderBy = verifiedFirst
    ? [STATUS_ORDER, desc(marketplaceListing.listedAt)]
    : [desc(marketplaceListing.listedAt)];

  const [rows, totalRow] = await Promise.all([
    db
      .select({
        id: marketplaceListing.id,
        tokenId: marketplaceListing.tokenId,
        seller: marketplaceListing.seller,
        fiatPrice1e8: marketplaceListing.fiatPrice1e8,
        currencyCode: marketplaceListing.currencyCode,
        agent: marketplaceListing.agent,
        agentFeeBps: marketplaceListing.agentFeeBps,
        ownerMinPrice1e8: marketplaceListing.ownerMinPrice1e8,
        active: marketplaceListing.active,
        listedAt: marketplaceListing.listedAt,
        soldAt: marketplaceListing.soldAt,
        buyer: marketplaceListing.buyer,
        status: passport.status,
        verifier: passport.verifier,
        vin: passport.vin,
        make: passport.make,
        model: passport.model,
        year: passport.year,
        mileageKm: passport.mileageKm,
        fuelType: passport.fuelType,
        bodyType: passport.bodyType,
        transmission: passport.transmission,
        condition: passport.condition,
        vehicleType: passport.vehicleType,
        colour: passport.colour,
        locationLabel: passport.locationLabel,
        tokenUri: passport.tokenUri,
        coverPhotoUri: passport.coverPhotoUri,
        duplicateVin: passport.duplicateVin,
      })
      .from(marketplaceListing)
      .leftJoin(passport, eq(marketplaceListing.tokenId, passport.id))
      .where(eq(marketplaceListing.active, true))
      .orderBy(...orderBy)
      .limit(limit)
      .offset(offset),
    db
      .select({ total: count() })
      .from(marketplaceListing)
      .where(eq(marketplaceListing.active, true)),
  ]);

  const listings = rows.map((row) => ({
    ...withLegacyFiatCurrency({
      id: row.id,
      tokenId: row.tokenId,
      seller: row.seller,
      fiatPrice1e8: row.fiatPrice1e8,
      currencyCode: row.currencyCode,
      agent: row.agent,
      agentFeeBps: row.agentFeeBps,
      ownerMinPrice1e8: row.ownerMinPrice1e8,
      active: row.active,
      listedAt: row.listedAt,
      soldAt: row.soldAt,
      buyer: row.buyer,
    }),
    passportStatus: row.status ?? "UNVERIFIED",
    verifier: row.verifier ?? "",
    vin: row.vin ?? "",
    make: row.make ?? "",
    model: row.model ?? "",
    year: row.year ?? 0,
    mileageKm: row.mileageKm ?? 0,
    fuelType: row.fuelType ?? "",
    bodyType: row.bodyType ?? "",
    transmission: row.transmission ?? "",
    condition: row.condition ?? "",
    vehicleType: row.vehicleType ?? "",
    colour: row.colour ?? "",
    locationLabel: row.locationLabel ?? "",
    tokenUri: row.tokenUri ?? "",
    coverPhotoUri: row.coverPhotoUri ?? "",
    duplicateVin: row.duplicateVin ?? false,
  }));

  return { listings, total: Number(totalRow[0]?.total ?? 0) };
}

app.get("/listings", async (c) => {
  const page = parsePage(c.req.query("page"));
  const limit = parseLimit(c.req.query("limit"));
  const seller = c.req.query("seller");
  const verifiedFirst = c.req.query("verifiedFirst") !== "false";
  const offset = (page - 1) * limit;
  const filters = parseListingFilterQuery({
    search: c.req.query("search"),
    make: c.req.query("make"),
    model: c.req.query("model"),
    yearMin: c.req.query("yearMin"),
    yearMax: c.req.query("yearMax"),
    mileageMin: c.req.query("mileageMin"),
    mileageMax: c.req.query("mileageMax"),
    fuelType: c.req.query("fuelType"),
    bodyType: c.req.query("bodyType"),
    transmission: c.req.query("transmission"),
    condition: c.req.query("condition"),
    vehicleType: c.req.query("vehicleType"),
    location: c.req.query("location"),
    colour: c.req.query("colour"),
    status: c.req.query("status"),
    priceMin: c.req.query("priceMin"),
    priceMax: c.req.query("priceMax"),
    priceCurrency: c.req.query("priceCurrency"),
    eurUsdRate: c.req.query("eurUsdRate"),
    ethUsdRate: c.req.query("ethUsdRate"),
    sort: c.req.query("sort"),
  });

  if (isDefaultListingsBrowse(filters, seller)) {
    const { listings, total } = await loadDefaultBrowsePage(limit, offset, verifiedFirst);
    return c.json(
      jsonBody({
        listings,
        total,
        page,
        limit,
      }),
    );
  }

  const conditions = [eq(marketplaceListing.active, true)];
  if (seller) {
    conditions.push(eq(marketplaceListing.seller, seller.toLowerCase()));
  }
  const where = and(...conditions);

  const allListings = await db
    .select()
    .from(marketplaceListing)
    .where(where)
    .orderBy(desc(marketplaceListing.listedAt));

  const tokenIds = [...new Set(allListings.map((l) => l.tokenId))];
  const passportMap = await loadPassportMap(tokenIds);

  const enriched = allListings.map((listing) => enrichListing(listing, passportMap));
  const sorted = filterAndSortListings(enriched, filters, verifiedFirst);
  const total = sorted.length;
  const pageRows = sorted.slice(offset, offset + limit);

  return c.json(
    jsonBody({
      listings: pageRows,
      total,
      page,
      limit,
    }),
  );
});

app.get("/listings/stats", async (c) => {
  const [totalRow, statusRows] = await Promise.all([
    db
      .select({ total: count() })
      .from(marketplaceListing)
      .where(eq(marketplaceListing.active, true)),
    db
      .select({
        status: passport.status,
        total: count(),
      })
      .from(marketplaceListing)
      .leftJoin(passport, eq(marketplaceListing.tokenId, passport.id))
      .where(eq(marketplaceListing.active, true))
      .groupBy(passport.status),
  ]);

  const statusCounts = { UNVERIFIED: 0, VERIFIED: 0, DISPUTED: 0 };
  for (const row of statusRows) {
    const status = row.status ?? "UNVERIFIED";
    if (status in statusCounts) {
      statusCounts[status as keyof typeof statusCounts] += Number(row.total);
    }
  }

  return c.json(
    jsonBody({
      totalActive: Number(totalRow[0]?.total ?? 0),
      statusCounts,
    }),
  );
});

app.get("/listings/facets", async (c) => {
  const [facetRows, fiatRows] = await Promise.all([
    loadActiveListingFacetRows(),
    db
      .select({
        currencyCode: marketplaceListing.currencyCode,
        count: count(),
      })
      .from(marketplaceListing)
      .where(eq(marketplaceListing.active, true))
      .groupBy(marketplaceListing.currencyCode),
  ]);

  const fiatCurrencySet = new Set<number>();
  for (const row of fiatRows) {
    fiatCurrencySet.add(legacyFiatFromCurrencyCode(row.currencyCode));
  }

  const facets = computeListingFacets(
    facetRows,
    facetRows.length,
    [...fiatCurrencySet].sort((a, b) => a - b),
  );

  return c.json({
    ...facets,
    priceMin: facets.priceRanges.USD.min,
    priceMax: facets.priceRanges.USD.max,
  });
});

app.get("/listings/:tokenId", async (c) => {
  const tokenId = c.req.param("tokenId");
  const listing = await db
    .select()
    .from(marketplaceListing)
    .where(eq(marketplaceListing.id, tokenId))
    .limit(1);

  if (!listing[0]) {
    return c.json({ error: "Not found" }, 404);
  }

  const passportRows = await db
    .select()
    .from(passport)
    .where(eq(passport.id, tokenId))
    .limit(1);
  const p = passportRows[0];
  const row = listing[0];
  return c.json(
    jsonBody({
      ...withLegacyFiatCurrency(row),
      passportStatus: p?.status ?? "UNVERIFIED",
      verifier: p?.verifier ?? "",
      vin: p?.vin ?? "",
      make: p?.make ?? "",
      model: p?.model ?? "",
      year: p?.year ?? 0,
      mileageKm: p?.mileageKm ?? 0,
      fuelType: p?.fuelType ?? "",
      bodyType: p?.bodyType ?? "",
      transmission: p?.transmission ?? "",
      tokenUri: p?.tokenUri ?? "",
      coverPhotoUri: p?.coverPhotoUri ?? "",
      duplicateVin: p?.duplicateVin ?? false,
    }),
  );
});

app.get("/passports", async (c) => {
  const page = parsePage(c.req.query("page"));
  const limit = parseLimit(c.req.query("limit"));
  const owner = c.req.query("owner");
  const verifierParam = c.req.query("verifier");
  const status =
    c.req.query("status") ?? (verifierParam ? "VERIFIED" : undefined);
  const vin = c.req.query("vin")?.toUpperCase();
  const verifiedFirst = c.req.query("verifiedFirst") !== "false";
  const offset = (page - 1) * limit;

  const conditions = [];
  if (owner) {
    conditions.push(eq(passport.owner, owner.toLowerCase()));
  }
  if (status) {
    conditions.push(eq(passport.status, status));
  }
  if (vin) {
    conditions.push(eq(passport.vin, vin));
  }
  if (verifierParam) {
    conditions.push(eq(passport.verifier, getAddress(verifierParam)));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const orderBy = verifiedFirst
    ? [STATUS_ORDER, desc(passport.createdAt)]
    : [desc(passport.createdAt)];

  const [passports, totalRow] = await Promise.all([
    db
      .select()
      .from(passport)
      .where(where)
      .orderBy(...orderBy)
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(passport).where(where),
  ]);

  const total = totalRow[0]?.total ?? 0;
  return c.json(
    jsonBody({
      passports,
      total,
      page,
      limit,
    }),
  );
});

app.get("/passports/batch", async (c) => {
  const ids = parseIdList(c.req.query("ids"));
  if (ids.length === 0) {
    return c.json(jsonBody({ passports: [] }));
  }

  const passports = await db
    .select()
    .from(passport)
    .where(inArray(passport.id, ids));

  return c.json(jsonBody({ passports }));
});

app.get("/listings/batch", async (c) => {
  const ids = parseIdList(c.req.query("ids"));
  if (ids.length === 0) {
    return c.json(jsonBody({ listings: [] }));
  }

  const listingsFound = await db
    .select()
    .from(marketplaceListing)
    .where(inArray(marketplaceListing.id, ids));
  const passportMap = await loadPassportMap(ids);
  const listings = listingsFound.map((listing) => enrichListing(listing, passportMap));

  return c.json(jsonBody({ listings }));
});

app.get("/notifications/:address", async (c) => {
  const address = c.req.param("address").toLowerCase();
  const sinceRaw = c.req.query("since") ?? "0";
  const since = BigInt(sinceRaw);
  const limit = parseLimit(c.req.query("limit"));

  const items = await buildNotificationFeed(db, address, since, limit);

  return c.json(
    jsonBody({
      items,
      since: String(since),
      limit,
    }),
  );
});

app.get("/passports/:tokenId", async (c) => {
  const tokenId = c.req.param("tokenId");
  const row = await db
    .select()
    .from(passport)
    .where(eq(passport.id, tokenId))
    .limit(1);

  if (!row[0]) {
    return c.json({ error: "Not found" }, 404);
  }

  const [records, uriHistory] = await Promise.all([
    db
      .select()
      .from(passportRecord)
      .where(eq(passportRecord.tokenId, tokenId))
      .orderBy(desc(passportRecord.timestamp)),
    db
      .select()
      .from(passportUriHistory)
      .where(eq(passportUriHistory.tokenId, tokenId))
      .orderBy(desc(passportUriHistory.timestamp)),
  ]);

  return c.json(jsonBody({ ...row[0], records, uriHistory }));
});

app.get("/profile/:address/passports", async (c) => {
  const address = c.req.param("address").toLowerCase();
  const passports = await db
    .select()
    .from(passport)
    .where(eq(passport.owner, address))
    .orderBy(desc(passport.createdAt));

  return c.json(jsonBody({ passports }));
});

app.get("/profile/:address/listings", async (c) => {
  const address = c.req.param("address").toLowerCase();
  const listings = await db
    .select()
    .from(marketplaceListing)
    .where(eq(marketplaceListing.seller, address))
    .orderBy(desc(marketplaceListing.listedAt));

  const tokenIds = [...new Set(listings.map((l) => l.tokenId))];
  const passportMap = await loadPassportMap(tokenIds);
  const enriched = listings.map((listing) => enrichListing(listing, passportMap));

  return c.json(jsonBody({ listings: enriched }));
});

app.get("/verifiers", async (c) => {
  const [rows, verificationRows] = await Promise.all([
    db
      .select()
      .from(verifier)
      .where(eq(verifier.active, true))
      .orderBy(desc(verifier.joinedAt)),
    db
      .select({ verifier: passport.verifier, total: count() })
      .from(passport)
      .where(eq(passport.status, "VERIFIED"))
      .groupBy(passport.verifier),
  ]);

  const verificationCountByVerifier = new Map<string, number>();
  for (const row of verificationRows) {
    if (!row.verifier) continue;
    verificationCountByVerifier.set(getAddress(row.verifier), Number(row.total));
  }

  const verifiers = rows.map((v) => ({
    ...v,
    verificationCount: verificationCountByVerifier.get(getAddress(v.id)) ?? 0,
  }));

  return c.json(jsonBody({ verifiers }));
});

function isValidSlugParam(slug: string): boolean {
  return (
    slug.length >= SLUG_MIN_LENGTH &&
    slug.length <= SLUG_MAX_LENGTH &&
    SLUG_PATTERN.test(slug)
  );
}

async function buildVerifierDetailResponse(id: string) {
  const row = await db
    .select()
    .from(verifier)
    .where(eq(verifier.id, id))
    .limit(1);

  if (!row[0]) return null;

  const v = row[0];
  const checksumVerifier = getAddress(id);
  const verificationRow = await db
    .select({ total: count() })
    .from(passport)
    .where(
      and(eq(passport.verifier, checksumVerifier), eq(passport.status, "VERIFIED")),
    );

  const verificationCount = verificationRow[0]?.total ?? 0;

  const disputedPassports = await db
    .select()
    .from(passport)
    .where(
      and(eq(passport.status, "DISPUTED"), eq(passport.verifier, checksumVerifier)),
    )
    .orderBy(desc(passport.updatedAt));

  const verifiedPassports = await db
    .select()
    .from(passport)
    .where(
      and(eq(passport.verifier, checksumVerifier), eq(passport.status, "VERIFIED")),
    )
    .orderBy(desc(passport.verifiedAt))
    .limit(20);

  return jsonBody({
    address: v.address,
    identity: {
      category: v.category,
      name: v.name,
      slug: v.slug,
      metadataURI: v.metadataURI,
    },
    stake: {
      asset: v.stakeAsset,
      amount: v.stakeAmount,
      active: v.active,
    },
    joinedAt: v.joinedAt,
    leftAt: v.leftAt,
    verificationCount,
    disputedPassports,
    verifiedPassports,
  });
}

app.get("/verifiers/by-slug/:slug", async (c) => {
  const slug = c.req.param("slug");
  const row = await db
    .select()
    .from(verifier)
    .where(and(eq(verifier.slug, slug), eq(verifier.active, true)))
    .limit(1);

  if (!row[0]) {
    return c.json({ error: "Not found" }, 404);
  }

  const detail = await buildVerifierDetailResponse(row[0].id);
  if (!detail) {
    return c.json({ error: "Not found" }, 404);
  }

  return c.json(detail);
});

app.get("/verifiers/slug-available/:slug", async (c) => {
  const slug = c.req.param("slug");
  const ownerAddress = c.req.query("address")?.toLowerCase();

  if (!isValidSlugParam(slug)) {
    return c.json({ available: false, slug });
  }

  const rows = await db
    .select()
    .from(verifier)
    .where(and(eq(verifier.slug, slug), eq(verifier.active, true)));

  const takenByOther = rows.some((row) => {
    if (!ownerAddress) return true;
    return row.id !== ownerAddress;
  });

  return c.json({ available: !takenByOther, slug });
});

app.get("/verifiers/:address", async (c) => {
  const id = c.req.param("address").toLowerCase();
  const detail = await buildVerifierDetailResponse(id);

  if (!detail) {
    return c.json({ error: "Not found" }, 404);
  }

  return c.json(detail);
});

app.get("/verifiers/:address/attestations", async (c) => {
  const id = c.req.param("address").toLowerCase();
  const limit = parseLimit(c.req.query("limit"));
  const offset = parseOffset(c.req.query("offset"));

  const where = and(
    eq(passportRecord.author, id),
    eq(passportRecord.recordType, ATTESTATION_RECORD_TYPE),
  );

  const [attestations, totalRow] = await Promise.all([
    db
      .select({
        tokenId: passportRecord.tokenId,
        description: passportRecord.description,
        evidenceCID: passportRecord.evidenceCID,
        timestamp: passportRecord.timestamp,
      })
      .from(passportRecord)
      .where(where)
      .orderBy(desc(passportRecord.timestamp))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(passportRecord).where(where),
  ]);

  return c.json(
    jsonBody({
      attestations,
      total: totalRow[0]?.total ?? 0,
      limit,
      offset,
    }),
  );
});

export default app;
