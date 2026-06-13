import { db } from "ponder:api";
import {
  karProHolder,
  marketplaceListing,
  passport,
} from "ponder:schema";
import {
  and,
  count,
  desc,
  eq,
  replaceBigInts,
} from "ponder";
import { Hono } from "hono";

const app = new Hono();

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

app.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: Date.now() });
});

app.get("/listings", async (c) => {
  const page = parsePage(c.req.query("page"));
  const limit = parseLimit(c.req.query("limit"));
  const seller = c.req.query("seller");
  const offset = (page - 1) * limit;

  const conditions = [eq(marketplaceListing.active, true)];
  if (seller) {
    conditions.push(eq(marketplaceListing.seller, seller.toLowerCase()));
  }
  const where = and(...conditions);

  const [listings, totalRow] = await Promise.all([
    db
      .select()
      .from(marketplaceListing)
      .where(where)
      .orderBy(desc(marketplaceListing.listedAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(marketplaceListing).where(where),
  ]);

  const total = totalRow[0]?.total ?? 0;
  return c.json(
    jsonBody({
      listings,
      total,
      page,
      limit,
    }),
  );
});

app.get("/listings/facets", async (c) => {
  const rows = await db
    .select({
      fiatCurrency: marketplaceListing.fiatCurrency,
      count: count(),
    })
    .from(marketplaceListing)
    .where(eq(marketplaceListing.active, true))
    .groupBy(marketplaceListing.fiatCurrency);

  const fiatCurrencies = rows.map((row) => row.fiatCurrency);
  const totalActive = rows.reduce((sum, row) => sum + row.count, 0);

  return c.json({ fiatCurrencies, totalActive });
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
  return c.json(jsonBody(listing[0]));
});

app.get("/passports", async (c) => {
  const page = parsePage(c.req.query("page"));
  const limit = parseLimit(c.req.query("limit"));
  const owner = c.req.query("owner");
  const status = c.req.query("status");
  const offset = (page - 1) * limit;

  const conditions = [];
  if (owner) {
    conditions.push(eq(passport.owner, owner.toLowerCase()));
  }
  if (status) {
    conditions.push(eq(passport.status, status));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [passports, totalRow] = await Promise.all([
    db
      .select()
      .from(passport)
      .where(where)
      .orderBy(desc(passport.createdAt))
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
  return c.json(jsonBody(row[0]));
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
    .from(karProHolder)
    .where(eq(karProHolder.active, true));

  return c.json(jsonBody({ verifiers }));
});

export default app;
