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
  replaceBigInts,
  sql,
} from "ponder";
import { Hono } from "hono";
import { getAddress } from "viem";

import {
  computeListingFacets,
  matchesListingFilters,
  parseListingFilterQuery,
  sortEnrichedListings,
  type EnrichedListingForFilter,
  type ListingFilterQuery,
} from "../../lib/marketplace/listing-query";

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
  tokenUri: string;
  duplicateVin: boolean;
};

async function loadPassportMap(
  tokenIds: string[],
): Promise<Map<string, PassportDenorm>> {
  const map = new Map<string, PassportDenorm>();
  if (tokenIds.length === 0) return map;
  for (const tokenId of tokenIds) {
    const row = await db.find(passport, { id: tokenId });
    if (row) {
      map.set(tokenId, {
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
        tokenUri: row.tokenUri,
        duplicateVin: row.duplicateVin,
      });
    }
  }
  return map;
}

function enrichListing(
  listing: {
    id: string;
    tokenId: string;
    seller: string;
    fiatPrice1e8: bigint;
    fiatCurrency: number;
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
    ...listing,
    make: p?.make ?? "",
    model: p?.model ?? "",
    year: p?.year ?? 0,
    mileageKm: p?.mileageKm ?? 0,
    fuelType: p?.fuelType ?? "",
    bodyType: p?.bodyType ?? "",
    transmission: p?.transmission ?? "",
    passportStatus,
    verifier: p?.verifier ?? "",
    vin: p?.vin ?? "",
    tokenUri: p?.tokenUri ?? "",
    duplicateVin: p?.duplicateVin ?? false,
  };
}

function filterAndSortListings(
  listings: Array<EnrichedListingForFilter & Record<string, unknown>>,
  filters: ListingFilterQuery,
  verifiedFirst: boolean,
) {
  const filtered = listings.filter((row) => matchesListingFilters(row, filters));
  return sortEnrichedListings(filtered, filters.sort ?? "newest", verifiedFirst);
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
    mileageMax: c.req.query("mileageMax"),
    fuelType: c.req.query("fuelType"),
    bodyType: c.req.query("bodyType"),
    transmission: c.req.query("transmission"),
    status: c.req.query("status"),
    currency: c.req.query("currency"),
    priceMin: c.req.query("priceMin"),
    priceMax: c.req.query("priceMax"),
    sort: c.req.query("sort"),
  });

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

app.get("/listings/facets", async (c) => {
  const activeListings = await db
    .select()
    .from(marketplaceListing)
    .where(eq(marketplaceListing.active, true));

  const tokenIds = [...new Set(activeListings.map((l) => l.tokenId))];
  const passportMap = await loadPassportMap(tokenIds);

  const fiatRows = await db
    .select({
      fiatCurrency: marketplaceListing.fiatCurrency,
      count: count(),
    })
    .from(marketplaceListing)
    .where(eq(marketplaceListing.active, true))
    .groupBy(marketplaceListing.fiatCurrency);

  const enriched = activeListings.map((listing) => enrichListing(listing, passportMap));
  const facets = computeListingFacets(
    enriched,
    activeListings.length,
    fiatRows.map((row) => row.fiatCurrency),
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

  const p = await db.find(passport, { id: tokenId });
  const row = listing[0];
  return c.json(
    jsonBody({
      ...row,
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
      duplicateVin: p?.duplicateVin ?? false,
    }),
  );
});

app.get("/passports", async (c) => {
  const page = parsePage(c.req.query("page"));
  const limit = parseLimit(c.req.query("limit"));
  const owner = c.req.query("owner");
  const status = c.req.query("status");
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
  const rows = await db
    .select()
    .from(verifier)
    .where(eq(verifier.active, true))
    .orderBy(desc(verifier.joinedAt));

  const verifiers = await Promise.all(
    rows.map(async (v) => {
      const verificationRow = await db
        .select({ total: count() })
        .from(passport)
        .where(eq(passport.verifier, getAddress(v.id)));
      return {
        ...v,
        verificationCount: verificationRow[0]?.total ?? 0,
      };
    }),
  );

  return c.json(jsonBody({ verifiers }));
});

app.get("/verifiers/:address", async (c) => {
  const id = c.req.param("address").toLowerCase();
  const row = await db
    .select()
    .from(verifier)
    .where(eq(verifier.id, id))
    .limit(1);

  if (!row[0]) {
    return c.json({ error: "Not found" }, 404);
  }

  const v = row[0];
  const verificationRow = await db
    .select({ total: count() })
    .from(passport)
    .where(eq(passport.verifier, getAddress(id)));

  const verificationCount = verificationRow[0]?.total ?? 0;

  const disputedPassports = await db
    .select()
    .from(passport)
    .where(
      and(eq(passport.status, "DISPUTED"), eq(passport.verifier, getAddress(id))),
    )
    .orderBy(desc(passport.updatedAt));

  const verifiedPassports = await db
    .select()
    .from(passport)
    .where(eq(passport.verifier, getAddress(id)))
    .orderBy(desc(passport.verifiedAt))
    .limit(20);

  return c.json(
    jsonBody({
      address: v.address,
      identity: {
        category: v.category,
        name: v.name,
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
    }),
  );
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
