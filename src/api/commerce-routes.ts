/**
 * Commerce-mode HTTP routes: consignment browse/detail, mandates,
 * commerce claim-credit E2E scan, and the shared BondedChallenge feed.
 * Product claims reader is `GET /accounts/:address/claims` in index.ts
 * (unions pending_claim + commerce_claim).
 */

import { db } from "ponder:api";
import {
  ascendingTerms,
  challenge,
  commerceClaim,
  commerceClaimCredit,
  commerceCurrencyFeed,
  commerceMode,
  commercePaymentToken,
  consignment,
  consignmentBid,
  consignmentHold,
  consignmentSettlement,
  mandate,
  passport,
} from "ponder:schema";
import { and, asc, count, desc, eq, gt, inArray, sql } from "ponder";
import type { Hono } from "hono";
import { getAddress, isAddress } from "viem";
import { replaceBigInts } from "ponder";

import {
  attachPassportCustodyAnswer,
  resolvePassportCustodyAnswersBatch,
  type PassportCustodyAnswer,
} from "../lib/ponder-passport-custody";
import {
  ALL_COMMERCE_PHASES,
  LIVE_PHASES,
  OPEN_PHASES,
} from "../lib/ponder-commerce";
import { parseChallengeStatusFilter } from "../../lib/challenge/browse-filters";
import {
  buildBrowseFilterConditions,
  buildBrowseOrderBy,
  emptyStatusCounts,
  foldStatusCounts,
  mergeBrowseWhere,
  parseConsignmentBrowseFilters,
} from "../lib/ponder-consignment-browse";
import { loadObligationFacts } from "./load-obligation-facts";

function parsePage(raw: string | undefined): number {
  const n = raw ? Number.parseInt(raw, 10) : 1;
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

function parseLimit(raw: string | undefined): number {
  const n = raw ? Number.parseInt(raw, 10) : 20;
  if (!Number.isFinite(n) || n < 1) return 20;
  return Math.min(n, 100);
}

function parseAddressParam(raw: string): `0x${string}` | null {
  const trimmed = raw.trim();
  if (!isAddress(trimmed)) return null;
  return getAddress(trimmed);
}

function parseOptionalChainId(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

function parseOptionalBoolean(raw: string | undefined): boolean | undefined {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return undefined;
}

function jsonBody<T>(value: T): T {
  return replaceBigInts(value, (v) => String(v)) as T;
}

const LIVE_PHASE_LIST = [...LIVE_PHASES];
const OPEN_PHASE_LIST = [...OPEN_PHASES];

type ConsignmentRow = typeof consignment.$inferSelect;
type PassportRow = typeof passport.$inferSelect;

function flattenPassportDenorm(
  row: ConsignmentRow,
  p: PassportRow | undefined,
  custody: PassportCustodyAnswer,
) {
  return {
    ...row,
    status: p?.status ?? null,
    coverPhotoUri: p?.coverPhotoUri ?? null,
    make: p?.make ?? null,
    model: p?.model ?? null,
    year: p?.year ?? null,
    vin: p?.vin ?? null,
    verifier: p?.verifier ?? null,
    mileageKm: p?.mileageKm ?? null,
    duplicateVin: p?.duplicateVin ?? null,
    fuelType: p?.fuelType ?? null,
    bodyType: p?.bodyType ?? null,
    transmission: p?.transmission ?? null,
    condition: p?.condition ?? null,
    vehicleType: p?.vehicleType ?? null,
    colour: p?.colour ?? null,
    locationPlaceId: p?.locationPlaceId ?? null,
    custodyChain: custody.custodyChain,
    custodyUnresolved: custody.custodyUnresolved,
    /** Immutable passport origin (`tokenId >> 128`). */
    originChainId: p?.chainId ?? row.chainId,
  };
}

/**
 * Batch enrich — query count independent of page size.
 * Flattens passport denorm onto the consignment wire (no nested passport object).
 */
async function enrichConsignmentsBatch(rows: ConsignmentRow[]) {
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const tokenIds = [...new Set(rows.map((r) => r.tokenId))];
  const ascendingIds = rows.filter((r) => r.mode === "ascending").map((r) => r.id);

  const [passports, settlements, terms, holds, custodyByToken] = await Promise.all([
    tokenIds.length > 0
      ? db.select().from(passport).where(inArray(passport.id, tokenIds))
      : Promise.resolve([] as PassportRow[]),
    ids.length > 0
      ? db
          .select()
          .from(consignmentSettlement)
          .where(inArray(consignmentSettlement.id, ids))
      : Promise.resolve([] as (typeof consignmentSettlement.$inferSelect)[]),
    ascendingIds.length > 0
      ? db
          .select()
          .from(ascendingTerms)
          .where(inArray(ascendingTerms.id, ascendingIds))
      : Promise.resolve([] as (typeof ascendingTerms.$inferSelect)[]),
    ascendingIds.length > 0
      ? db
          .select()
          .from(consignmentHold)
          .where(inArray(consignmentHold.id, ascendingIds))
      : Promise.resolve([] as (typeof consignmentHold.$inferSelect)[]),
    resolvePassportCustodyAnswersBatch(tokenIds),
  ]);

  const passportById = new Map(passports.map((p) => [p.id, p]));
  const settlementById = new Map(settlements.map((s) => [s.id, s]));
  const termsById = new Map(terms.map((t) => [t.id, t]));
  const holdById = new Map(holds.map((h) => [h.id, h]));

  return rows.map((row) => {
    const custody =
      custodyByToken.get(row.tokenId) ?? {
        custodyChain: null,
        custodyUnresolved: "empty_history" as const,
      };
    const flat = flattenPassportDenorm(row, passportById.get(row.tokenId), custody);
    return {
      ...flat,
      ascendingTerms: termsById.get(row.id) ?? null,
      hold: holdById.get(row.id) ?? null,
      settlement: settlementById.get(row.id) ?? null,
    };
  });
}

async function enrichConsignment(row: ConsignmentRow) {
  const [enriched] = await enrichConsignmentsBatch([row]);
  return enriched!;
}

export function registerCommerceRoutes(app: Hono): void {
  /**
   * Address-centric commerce facts for outstanding-obligation derivation.
   * Union across all commercial chains; optional ?chainId= filter.
   * Shape is a facts bag — consumers call deriveOutstandingObligations.
   */
  app.get("/accounts/:address/obligations", async (c) => {
    const address = parseAddressParam(c.req.param("address"));
    if (!address) return c.json({ error: "Invalid address" }, 400);
    const chainId = parseOptionalChainId(c.req.query("chainId"));
    const facts = await loadObligationFacts(address, chainId);
    return c.json(jsonBody({ address, ...facts }));
  });

  /** Browse — marketplace + auctions cutover. */
  app.get("/consignments", async (c) => {
    const page = parsePage(c.req.query("page"));
    const limit = parseLimit(c.req.query("limit"));
    const offset = (page - 1) * limit;
    const mode = c.req.query("mode");
    const active = parseOptionalBoolean(c.req.query("active"));
    const phase = c.req.query("phase");
    const chainId = parseOptionalChainId(c.req.query("chainId"));
    const sellerParam = c.req.query("seller");
    const agentParam = c.req.query("agent");

    const browseFilters = parseConsignmentBrowseFilters({
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
      placeId: c.req.query("placeId"),
      colour: c.req.query("colour"),
      status: c.req.query("status"),
      priceMin: c.req.query("priceMin"),
      priceMax: c.req.query("priceMax"),
      priceCurrency: c.req.query("priceCurrency"),
      eurUsdRate: c.req.query("eurUsdRate"),
      ethUsdRate: c.req.query("ethUsdRate"),
      btcUsdRate: c.req.query("btcUsdRate"),
      cnyUsdRate: c.req.query("cnyUsdRate"),
      inrUsdRate: c.req.query("inrUsdRate"),
      brlUsdRate: c.req.query("brlUsdRate"),
      idrUsdRate: c.req.query("idrUsdRate"),
      audUsdRate: c.req.query("audUsdRate"),
      aedUsdRate: c.req.query("aedUsdRate"),
      krwUsdRate: c.req.query("krwUsdRate"),
      rubUsdRate: c.req.query("rubUsdRate"),
      jpyUsdRate: c.req.query("jpyUsdRate"),
      sort: c.req.query("sort"),
      verifiedFirst: c.req.query("verifiedFirst"),
    });

    const baseConditions = [];
    if (mode === "fixedPrice" || mode === "ascending") {
      baseConditions.push(eq(consignment.mode, mode));
    }
    // `active` = open for buy/bid (offered|binding). Held stays out of browse.
    if (active === true) {
      baseConditions.push(inArray(consignment.phase, OPEN_PHASE_LIST));
    } else if (active === false) {
      baseConditions.push(
        sql`${consignment.phase} NOT IN (${sql.join(
          OPEN_PHASE_LIST.map((p) => sql`${p}`),
          sql`, `,
        )})`,
      );
    }
    if (phase) {
      if (!ALL_COMMERCE_PHASES.has(phase)) {
        return c.json({ error: "Invalid phase" }, 400);
      }
      baseConditions.push(eq(consignment.phase, phase));
    }
    if (chainId !== undefined) {
      baseConditions.push(eq(consignment.chainId, chainId));
    }
    if (sellerParam) {
      const seller = parseAddressParam(sellerParam);
      if (!seller) return c.json({ error: "Invalid seller" }, 400);
      baseConditions.push(eq(consignment.seller, seller));
    }
    if (agentParam) {
      const agent = parseAddressParam(agentParam);
      if (!agent) return c.json({ error: "Invalid agent" }, 400);
      baseConditions.push(eq(consignment.agent, agent));
    }

    const filterResult = buildBrowseFilterConditions(browseFilters);
    const where = mergeBrowseWhere(baseConditions, filterResult);
    const orderBy = buildBrowseOrderBy(browseFilters, filterResult.rates);

    const [joinedRows, totalRow, statusRows] = await Promise.all([
      db
        .select({ consignment })
        .from(consignment)
        .leftJoin(passport, eq(consignment.tokenId, passport.id))
        .where(where)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset),
      db
        .select({ value: count() })
        .from(consignment)
        .leftJoin(passport, eq(consignment.tokenId, passport.id))
        .where(where),
      db
        .select({
          status: passport.status,
          total: count(),
        })
        .from(consignment)
        .leftJoin(passport, eq(consignment.tokenId, passport.id))
        .where(where)
        .groupBy(passport.status),
    ]);

    const rows = joinedRows.map((r) => r.consignment);
    const consignments = await enrichConsignmentsBatch(rows);
    const statusCounts = filterResult.empty
      ? emptyStatusCounts()
      : foldStatusCounts(statusRows);

    return c.json(
      jsonBody({
        consignments,
        total: totalRow[0]?.value ?? 0,
        page,
        limit,
        statusCounts,
      }),
    );
  });

  /** Passport commerce rail — live preferred, else latest open. */
  app.get("/consignments/by-token/:tokenId", async (c) => {
    const tokenId = c.req.param("tokenId");
    const chainId = parseOptionalChainId(c.req.query("chainId"));
    const mode = c.req.query("mode");

    const liveConditions = [
      eq(consignment.tokenId, tokenId),
      inArray(consignment.phase, LIVE_PHASE_LIST),
    ];
    if (chainId !== undefined) liveConditions.push(eq(consignment.chainId, chainId));
    if (mode === "fixedPrice" || mode === "ascending") {
      liveConditions.push(eq(consignment.mode, mode));
    }

    let row = (
      await db
        .select()
        .from(consignment)
        .where(and(...liveConditions))
        .orderBy(desc(consignment.openedAt))
        .limit(1)
    )[0];

    if (!row) {
      const histConditions = [eq(consignment.tokenId, tokenId)];
      if (chainId !== undefined) histConditions.push(eq(consignment.chainId, chainId));
      if (mode === "fixedPrice" || mode === "ascending") {
        histConditions.push(eq(consignment.mode, mode));
      }
      row = (
        await db
          .select()
          .from(consignment)
          .where(and(...histConditions))
          .orderBy(desc(consignment.openedAt))
          .limit(1)
      )[0];
    }

    if (!row) return c.json({ error: "Not found" }, 404);
    return c.json(jsonBody({ consignment: await enrichConsignment(row) }));
  });

  /** Deep link by append-only id. */
  app.get("/consignments/:id", async (c) => {
    const id = c.req.param("id");
    // Avoid shadowing by-token — Hono matches more specific routes first if registered first.
    if (id === "by-token") return c.json({ error: "Not found" }, 404);
    const row = (await db.select().from(consignment).where(eq(consignment.id, id)).limit(1))[0];
    if (!row) return c.json({ error: "Not found" }, 404);
    return c.json(jsonBody({ consignment: await enrichConsignment(row) }));
  });

  app.get("/consignments/:id/bids", async (c) => {
    const id = c.req.param("id");
    const page = parsePage(c.req.query("page"));
    const limit = parseLimit(c.req.query("limit"));
    const offset = (page - 1) * limit;

    const parent = (
      await db.select({ id: consignment.id }).from(consignment).where(eq(consignment.id, id)).limit(1)
    )[0];
    if (!parent) return c.json({ error: "Not found" }, 404);

    const where = eq(consignmentBid.consignmentId, id);
    const [bids, totalRow] = await Promise.all([
      db
        .select()
        .from(consignmentBid)
        .where(where)
        .orderBy(desc(consignmentBid.timestamp))
        .limit(limit)
        .offset(offset),
      db.select({ value: count() }).from(consignmentBid).where(where),
    ]);

    return c.json(
      jsonBody({
        bids,
        total: totalRow[0]?.value ?? 0,
        page,
        limit,
      }),
    );
  });

  app.get("/agents/:address/mandates", async (c) => {
    const agent = parseAddressParam(c.req.param("address"));
    if (!agent) return c.json({ error: "Invalid address" }, 400);
    const page = parsePage(c.req.query("page"));
    const limit = parseLimit(c.req.query("limit"));
    const offset = (page - 1) * limit;
    const activeOnly = parseOptionalBoolean(c.req.query("active")) ?? true;

    const conditions = [eq(mandate.agent, agent)];
    if (activeOnly) conditions.push(eq(mandate.active, true));
    const where = and(...conditions);

    const [rows, totalRow] = await Promise.all([
      db
        .select()
        .from(mandate)
        .where(where)
        .orderBy(desc(mandate.grantedAt))
        .limit(limit)
        .offset(offset),
      db.select({ value: count() }).from(mandate).where(where),
    ]);

    return c.json(
      jsonBody({
        mandates: rows,
        total: totalRow[0]?.value ?? 0,
        page,
        limit,
      }),
    );
  });

  app.get("/owners/:address/mandates", async (c) => {
    const owner = parseAddressParam(c.req.param("address"));
    if (!owner) return c.json({ error: "Invalid address" }, 400);
    const page = parsePage(c.req.query("page"));
    const limit = parseLimit(c.req.query("limit"));
    const offset = (page - 1) * limit;
    const activeOnly = parseOptionalBoolean(c.req.query("active")) ?? true;

    const conditions = [eq(mandate.owner, owner)];
    if (activeOnly) conditions.push(eq(mandate.active, true));
    const where = and(...conditions);

    const [rows, totalRow] = await Promise.all([
      db
        .select()
        .from(mandate)
        .where(where)
        .orderBy(desc(mandate.grantedAt))
        .limit(limit)
        .offset(offset),
      db.select({ value: count() }).from(mandate).where(where),
    ]);

    return c.json(
      jsonBody({
        mandates: rows,
        total: totalRow[0]?.value ?? 0,
        page,
        limit,
      }),
    );
  });

  app.get("/agents/:address/consignments", async (c) => {
    const agent = parseAddressParam(c.req.param("address"));
    if (!agent) return c.json({ error: "Invalid address" }, 400);
    const page = parsePage(c.req.query("page"));
    const limit = parseLimit(c.req.query("limit"));
    const offset = (page - 1) * limit;
    const awaiting = parseOptionalBoolean(c.req.query("awaiting"));
    const phase = c.req.query("phase");

    if (awaiting === true) {
      // Mandates without a live consignment on the same mode+token.
      const authRows = await db
        .select()
        .from(mandate)
        .where(and(eq(mandate.agent, agent), eq(mandate.active, true)));

      const live = await db
        .select({
          tokenId: consignment.tokenId,
          modeContract: consignment.modeContract,
        })
        .from(consignment)
        .where(
          and(
            eq(consignment.agent, agent),
            inArray(consignment.phase, LIVE_PHASE_LIST),
          ),
        );
      const liveKeys = new Set(live.map((r) => `${r.modeContract.toLowerCase()}-${r.tokenId}`));
      const waiting = authRows.filter(
        (m) => !liveKeys.has(`${m.modeContract.toLowerCase()}-${m.tokenId}`),
      );
      const total = waiting.length;
      const slice = waiting.slice(offset, offset + limit);
      return c.json(
        jsonBody({
          consignments: [],
          mandates: slice,
          total,
          page,
          limit,
        }),
      );
    }

    const conditions = [eq(consignment.agent, agent)];
    if (phase) conditions.push(eq(consignment.phase, phase));
    const where = and(...conditions);

    const [rows, totalRow] = await Promise.all([
      db
        .select()
        .from(consignment)
        .where(where)
        .orderBy(desc(consignment.openedAt))
        .limit(limit)
        .offset(offset),
      db.select({ value: count() }).from(consignment).where(where),
    ]);

    const consignments = await enrichConsignmentsBatch(rows);
    return c.json(
      jsonBody({
        consignments,
        total: totalRow[0]?.value ?? 0,
        page,
        limit,
      }),
    );
  });

  /**
   * Whole-table commerce claim credit scan — local E2E unknown-reason gate.
   * Optional exact `reasonCode` filter (e.g. `unknown`).
   */
  app.get("/commerce-claim-credits", async (c) => {
    const page = parsePage(c.req.query("page"));
    const limit = parseLimit(c.req.query("limit"));
    const offset = (page - 1) * limit;
    const chainId = parseOptionalChainId(c.req.query("chainId"));
    const reasonCode = c.req.query("reasonCode");

    const conditions = [];
    if (chainId !== undefined) conditions.push(eq(commerceClaimCredit.chainId, chainId));
    if (reasonCode !== undefined && reasonCode.trim() !== "") {
      conditions.push(eq(commerceClaimCredit.reasonCode, reasonCode.trim()));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, totalRow] = await Promise.all([
      db
        .select()
        .from(commerceClaimCredit)
        .where(where)
        .orderBy(asc(commerceClaimCredit.timestamp), asc(commerceClaimCredit.id))
        .limit(limit)
        .offset(offset),
      db.select({ value: count() }).from(commerceClaimCredit).where(where),
    ]);

    return c.json(
      jsonBody({
        credits: rows.map((r) => ({
          id: r.id,
          chainId: r.chainId,
          contract: r.contract,
          account: r.account,
          asset: r.asset,
          amount: r.amount,
          reasonCode: r.reasonCode,
          causeEvent: r.causeEvent,
          timestamp: r.timestamp,
        })),
        total: totalRow[0]?.value ?? 0,
        page,
        limit,
      }),
    );
  });

  /** BondedChallenge rows shared by KarPassport disputes and AscendingConsignment. */
  app.get("/challenges", async (c) => {
    const page = parsePage(c.req.query("page"));
    const limit = parseLimit(c.req.query("limit"));
    const offset = (page - 1) * limit;
    const instance = c.req.query("instance");
    const subjectId = c.req.query("subjectId");
    const challengerParam = c.req.query("challenger");
    const chainId = parseOptionalChainId(c.req.query("chainId"));
    const statuses = parseChallengeStatusFilter(c.req.query("status"));
    if (statuses === null) {
      return c.json({ error: "Invalid status" }, 400);
    }

    const conditions = [];
    if (instance === "passport" || instance === "ascending") {
      conditions.push(eq(challenge.instance, instance));
    }
    if (statuses && statuses.length === 1) {
      conditions.push(eq(challenge.status, statuses[0]!));
    } else if (statuses && statuses.length > 1) {
      conditions.push(inArray(challenge.status, statuses));
    }
    if (subjectId) {
      conditions.push(eq(challenge.subjectId, subjectId));
    }
    if (challengerParam) {
      const challenger = parseAddressParam(challengerParam);
      if (!challenger) return c.json({ error: "Invalid challenger" }, 400);
      conditions.push(eq(challenge.challenger, challenger));
    }
    if (chainId !== undefined) {
      conditions.push(eq(challenge.chainId, chainId));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, totalRow] = await Promise.all([
      db
        .select()
        .from(challenge)
        .where(where)
        .orderBy(desc(challenge.openedAt))
        .limit(limit)
        .offset(offset),
      db.select({ value: count() }).from(challenge).where(where),
    ]);

    const challenges =
      instance === "passport"
        ? await (async () => {
            const subjectIds = [...new Set(rows.map((r) => r.subjectId))];
            const custodyByToken = await resolvePassportCustodyAnswersBatch(subjectIds);
            return Promise.all(
              rows.map(async (row) => {
                const pass = (
                  await db
                    .select()
                    .from(passport)
                    .where(eq(passport.id, row.subjectId))
                    .limit(1)
                )[0];
                const custody =
                  custodyByToken.get(row.subjectId) ?? {
                    custodyChain: null,
                    custodyUnresolved: "empty_history" as const,
                  };
                return {
                  ...row,
                  passport: pass
                    ? attachPassportCustodyAnswer(
                        {
                          status: pass.status,
                          coverPhotoUri: pass.coverPhotoUri,
                          make: pass.make,
                          model: pass.model,
                          year: pass.year,
                          vin: pass.vin,
                        },
                        custody,
                      )
                    : null,
                };
              }),
            );
          })()
        : rows;

    return c.json(
      jsonBody({
        challenges,
        total: totalRow[0]?.value ?? 0,
        page,
        limit,
      }),
    );
  });

  /** Indexed mode pause/guardian/rules mirror (ops + Nuclear readiness). */
  app.get("/commerce-modes", async (c) => {
    const page = parsePage(c.req.query("page"));
    const limit = parseLimit(c.req.query("limit"));
    const offset = (page - 1) * limit;
    const chainId = parseOptionalChainId(c.req.query("chainId"));
    const mode = c.req.query("mode");
    const paused = parseOptionalBoolean(c.req.query("paused"));

    const conditions = [];
    if (chainId !== undefined) conditions.push(eq(commerceMode.chainId, chainId));
    if (mode === "fixedPrice" || mode === "ascending") {
      conditions.push(eq(commerceMode.mode, mode));
    }
    if (paused !== undefined) conditions.push(eq(commerceMode.paused, paused));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, totalRow] = await Promise.all([
      db
        .select()
        .from(commerceMode)
        .where(where)
        .orderBy(asc(commerceMode.modeContract))
        .limit(limit)
        .offset(offset),
      db.select({ value: count() }).from(commerceMode).where(where),
    ]);

    return c.json(
      jsonBody({
        modes: rows,
        total: totalRow[0]?.value ?? 0,
        page,
        limit,
      }),
    );
  });

  /** Admitted payment tokens per mode (soft-revoke → active=false). */
  app.get("/commerce-payment-tokens", async (c) => {
    const page = parsePage(c.req.query("page"));
    const limit = parseLimit(c.req.query("limit"));
    const offset = (page - 1) * limit;
    const chainId = parseOptionalChainId(c.req.query("chainId"));
    const modeContractParam = c.req.query("modeContract");
    const active = parseOptionalBoolean(c.req.query("active"));

    const conditions = [];
    if (chainId !== undefined) {
      conditions.push(eq(commercePaymentToken.chainId, chainId));
    }
    if (modeContractParam) {
      const modeContract = parseAddressParam(modeContractParam);
      if (!modeContract) return c.json({ error: "Invalid modeContract" }, 400);
      conditions.push(eq(commercePaymentToken.modeContract, modeContract));
    }
    if (active !== undefined) {
      conditions.push(eq(commercePaymentToken.active, active));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, totalRow] = await Promise.all([
      db
        .select()
        .from(commercePaymentToken)
        .where(where)
        .orderBy(asc(commercePaymentToken.token))
        .limit(limit)
        .offset(offset),
      db.select({ value: count() }).from(commercePaymentToken).where(where),
    ]);

    return c.json(
      jsonBody({
        paymentTokens: rows,
        total: totalRow[0]?.value ?? 0,
        page,
        limit,
      }),
    );
  });

  /** FixedPrice fiat currency → Chainlink feed registry projection. */
  app.get("/commerce-currency-feeds", async (c) => {
    const page = parsePage(c.req.query("page"));
    const limit = parseLimit(c.req.query("limit"));
    const offset = (page - 1) * limit;
    const chainId = parseOptionalChainId(c.req.query("chainId"));
    const modeContractParam = c.req.query("modeContract");
    const currencyCode = c.req.query("currencyCode");

    const conditions = [];
    if (chainId !== undefined) {
      conditions.push(eq(commerceCurrencyFeed.chainId, chainId));
    }
    if (modeContractParam) {
      const modeContract = parseAddressParam(modeContractParam);
      if (!modeContract) return c.json({ error: "Invalid modeContract" }, 400);
      conditions.push(eq(commerceCurrencyFeed.modeContract, modeContract));
    }
    if (currencyCode) {
      conditions.push(eq(commerceCurrencyFeed.currencyCode, currencyCode));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, totalRow] = await Promise.all([
      db
        .select()
        .from(commerceCurrencyFeed)
        .where(where)
        .orderBy(asc(commerceCurrencyFeed.currencyCode))
        .limit(limit)
        .offset(offset),
      db.select({ value: count() }).from(commerceCurrencyFeed).where(where),
    ]);

    return c.json(
      jsonBody({
        currencyFeeds: rows,
        total: totalRow[0]?.value ?? 0,
        page,
        limit,
      }),
    );
  });
}
