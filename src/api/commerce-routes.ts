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
  ALL_COMMERCE_PHASES,
  LIVE_PHASES,
  OPEN_PHASES,
} from "../lib/ponder-commerce";
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

/**
 * Flatten passport denorm onto the consignment wire — matches
 * `PonderConsignmentRow` (status/make/…/custodyChain). Nested `passport`
 * objects are not part of the product contract.
 */
async function enrichConsignment(row: typeof consignment.$inferSelect) {
  const [terms, hold, settlement, pass] = await Promise.all([
    row.mode === "ascending"
      ? db.select().from(ascendingTerms).where(eq(ascendingTerms.id, row.id)).limit(1)
      : Promise.resolve([] as (typeof ascendingTerms.$inferSelect)[]),
    row.mode === "ascending"
      ? db.select().from(consignmentHold).where(eq(consignmentHold.id, row.id)).limit(1)
      : Promise.resolve([] as (typeof consignmentHold.$inferSelect)[]),
    db
      .select()
      .from(consignmentSettlement)
      .where(eq(consignmentSettlement.id, row.id))
      .limit(1),
    db.select().from(passport).where(eq(passport.id, row.tokenId)).limit(1),
  ]);
  const p = pass[0];
  return {
    ...row,
    ascendingTerms: terms[0] ?? null,
    hold: hold[0] ?? null,
    settlement: settlement[0] ?? null,
    status: p?.status ?? null,
    coverPhotoUri: p?.coverPhotoUri ?? null,
    make: p?.make ?? null,
    model: p?.model ?? null,
    year: p?.year ?? null,
    vin: p?.vin ?? null,
    verifier: p?.verifier ?? null,
    mileageKm: p?.mileageKm ?? null,
    duplicateVin: p?.duplicateVin ?? null,
    custodyChain: p?.custodyChain ?? row.chainId,
    /** Immutable passport origin (`tokenId >> 128`). */
    originChainId: p?.chainId ?? row.chainId,
  };
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

    const conditions = [];
    if (mode === "fixedPrice" || mode === "ascending") {
      conditions.push(eq(consignment.mode, mode));
    }
    // `active` = open for buy/bid (offered|binding). Held stays out of browse.
    if (active === true) {
      conditions.push(inArray(consignment.phase, OPEN_PHASE_LIST));
    } else if (active === false) {
      conditions.push(
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
      conditions.push(eq(consignment.phase, phase));
    }
    if (chainId !== undefined) {
      conditions.push(eq(consignment.chainId, chainId));
    }
    if (sellerParam) {
      const seller = parseAddressParam(sellerParam);
      if (!seller) return c.json({ error: "Invalid seller" }, 400);
      conditions.push(eq(consignment.seller, seller));
    }
    if (agentParam) {
      const agent = parseAddressParam(agentParam);
      if (!agent) return c.json({ error: "Invalid agent" }, 400);
      conditions.push(eq(consignment.agent, agent));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

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

    const consignments = await Promise.all(rows.map((r) => enrichConsignment(r)));

    return c.json(
      jsonBody({
        consignments,
        total: totalRow[0]?.value ?? 0,
        page,
        limit,
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

    const consignments = await Promise.all(rows.map((r) => enrichConsignment(r)));
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
    const status = c.req.query("status");
    const subjectId = c.req.query("subjectId");
    const challengerParam = c.req.query("challenger");
    const chainId = parseOptionalChainId(c.req.query("chainId"));

    const conditions = [];
    if (instance === "passport" || instance === "ascending") {
      conditions.push(eq(challenge.instance, instance));
    }
    if (status) {
      conditions.push(eq(challenge.status, status));
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
        ? await Promise.all(
            rows.map(async (row) => {
              const pass = (
                await db
                  .select()
                  .from(passport)
                  .where(eq(passport.id, row.subjectId))
                  .limit(1)
              )[0];
              return {
                ...row,
                passport: pass
                  ? {
                      status: pass.status,
                      coverPhotoUri: pass.coverPhotoUri,
                      make: pass.make,
                      model: pass.model,
                      year: pass.year,
                      vin: pass.vin,
                      custodyChain: pass.custodyChain,
                    }
                  : null,
              };
            }),
          )
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
