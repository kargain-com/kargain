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

function jsonBody<T>(value: T): T {
  return replaceBigInts(value, (v) => String(v)) as T;
}

type PassportDenorm = {
  status: string;
  vin: string;
  make: string;
  model: string;
  year: number;
  mileageKm: number;
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
        vin: row.vin,
        make: row.make,
        model: row.model,
        year: row.year,
        mileageKm: row.mileageKm,
        tokenUri: row.tokenUri,
        duplicateVin: row.duplicateVin,
      });
    }
  }
  return map;
}

app.get("/listings", async (c) => {
  const page = parsePage(c.req.query("page"));
  const limit = parseLimit(c.req.query("limit"));
  const seller = c.req.query("seller");
  const statusFilter = c.req.query("status");
  const verifiedFirst = c.req.query("verifiedFirst") !== "false";
  const offset = (page - 1) * limit;

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

  let enriched = allListings.map((listing) => {
    const p = passportMap.get(listing.tokenId);
    return {
      ...listing,
      passportStatus: p?.status ?? "UNVERIFIED",
      vin: p?.vin ?? "",
      make: p?.make ?? "",
      model: p?.model ?? "",
      year: p?.year ?? 0,
      mileageKm: p?.mileageKm ?? 0,
      tokenUri: p?.tokenUri ?? "",
      duplicateVin: p?.duplicateVin ?? false,
    };
  });

  if (statusFilter && statusFilter !== "all") {
    enriched = enriched.filter((l) => l.passportStatus === statusFilter);
  }

  if (verifiedFirst) {
    const rank = (s: string) =>
      s === "VERIFIED" ? 0 : s === "UNVERIFIED" ? 1 : 2;
    enriched.sort((a, b) => {
      const dr = rank(a.passportStatus) - rank(b.passportStatus);
      if (dr !== 0) return dr;
      return Number(b.listedAt - a.listedAt);
    });
  }

  const total = enriched.length;
  const pageRows = enriched.slice(offset, offset + limit);

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

  const makes = new Set<string>();
  const models: Record<string, Set<string>> = {};
  let yearMin = Number.MAX_SAFE_INTEGER;
  let yearMax = 0;
  let mileageMax = 0;
  const statusCounts = { UNVERIFIED: 0, VERIFIED: 0, DISPUTED: 0 };

  for (const listing of activeListings) {
    const p = passportMap.get(listing.tokenId);
    if (!p) continue;
    if (p.make) {
      makes.add(p.make);
      if (!models[p.make]) models[p.make] = new Set();
      if (p.model) models[p.make].add(p.model);
    }
    if (p.year > 0) {
      yearMin = Math.min(yearMin, p.year);
      yearMax = Math.max(yearMax, p.year);
    }
    if (p.mileageKm > 0) mileageMax = Math.max(mileageMax, p.mileageKm);
    if (p.status in statusCounts) {
      statusCounts[p.status as keyof typeof statusCounts] += 1;
    }
  }

  const fiatCurrencies = fiatRows.map((row) => row.fiatCurrency);
  const totalActive = activeListings.length;

  return c.json({
    fiatCurrencies,
    totalActive,
    makes: [...makes].sort(),
    models: Object.fromEntries(
      Object.entries(models).map(([k, v]) => [k, [...v].sort()]),
    ),
    yearMin: yearMin === Number.MAX_SAFE_INTEGER ? 0 : yearMin,
    yearMax,
    priceMin: 0,
    priceMax: 0,
    mileageMax,
    statusCounts,
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
  return c.json(
    jsonBody({
      ...listing[0],
      passportStatus: p?.status ?? "UNVERIFIED",
      vin: p?.vin ?? "",
      make: p?.make ?? "",
      model: p?.model ?? "",
      year: p?.year ?? 0,
      mileageKm: p?.mileageKm ?? 0,
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

  return c.json(jsonBody({ listings }));
});

app.get("/verifiers", async (c) => {
  const verifiers = await db
    .select()
    .from(verifier)
    .where(eq(verifier.active, true))
    .orderBy(desc(verifier.joinedAt));

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

export default app;
