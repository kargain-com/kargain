/**
 * Raw SQL consignment browse with passport entity UNION join (S7c-4).
 * Filter parse/bounds: `lib/marketplace/consignment-browse-filters.ts`.
 * Drizzle browse owner (EVM-only passport): `ponder-consignment-browse.ts`.
 */

import pg from "pg";

import { DENOMINATION_KIND } from "@/lib/commerce/denomination";
import {
  ASKING_NATIVE_ASSET,
  askingAssetUsdScale,
  askingNativeDecimals,
  askingUsdcFacts,
} from "@/lib/commerce/listing-price-display";
import {
  parseFxRatesFromQuery,
  resolveFilterBoundsUsd1e8,
  type ConsignmentBrowseFilters,
} from "@/lib/marketplace/consignment-browse-filters";
import {
  FIAT_SCALE,
  type PartialFxRates,
} from "@/lib/marketplace/price-normalize";

import {
  buildPassportEntityUnionSubquery,
  resolveEntityNamespaces,
  type PassportEntityQueryOptions,
} from "./ponder-passport-entity";
import {
  emptyStatusCounts,
  foldStatusCounts,
} from "./ponder-consignment-browse";

export type { ConsignmentBrowseFilters } from "@/lib/marketplace/consignment-browse-filters";

export type RawBrowseSqlInput = {
  clauses: string[];
  params: unknown[];
};

export type ConsignmentEntityBrowseRow = {
  id: string;
  chainId: number;
  mode: string;
  modeContract: string;
  tokenId: string;
  saleOrdinal: number;
  seller: string;
  agent: string;
  asset: string;
  denominationKind: number;
  currencyCode: string;
  floor: bigint;
  compensationForm: number;
  commissionBps: number;
  price: bigint;
  platformFeeBps: number;
  phase: string;
  closeReason: number | null;
  openedAt: bigint;
  closedAt: bigint | null;
  recallRequestedAt: bigint | null;
  buyer: string;
  settlementNoteSetAt: bigint | null;
  settlementNoteSetter: string;
  openTxHash: string;
  openLogIndex: number;
  updatedAt: bigint;
};

type ConsignmentPgRow = {
  id: string;
  chainId: number;
  mode: string;
  modeContract: string;
  tokenId: string;
  saleOrdinal: number;
  seller: string;
  agent: string;
  asset: string;
  denominationKind: number;
  currencyCode: string;
  floor: string;
  compensationForm: number;
  commissionBps: number;
  price: string;
  platformFeeBps: number;
  phase: string;
  closeReason: number | null;
  openedAt: string;
  closedAt: string | null;
  recallRequestedAt: string | null;
  buyer: string;
  settlementNoteSetAt: string | null;
  settlementNoteSetter: string;
  openTxHash: string;
  openLogIndex: number;
  updatedAt: string;
};

const CONSIGNMENT_SELECT = `c.id,
  c."chainId" AS "chainId",
  c.mode,
  c."modeContract" AS "modeContract",
  c."tokenId" AS "tokenId",
  c."saleOrdinal" AS "saleOrdinal",
  c.seller,
  c.agent,
  c.asset,
  c."denominationKind" AS "denominationKind",
  c."currencyCode" AS "currencyCode",
  c.floor,
  c."compensationForm" AS "compensationForm",
  c."commissionBps" AS "commissionBps",
  c.price,
  c."platformFeeBps" AS "platformFeeBps",
  c.phase,
  c."closeReason" AS "closeReason",
  c."openedAt" AS "openedAt",
  c."closedAt" AS "closedAt",
  c."recallRequestedAt" AS "recallRequestedAt",
  c.buyer,
  c."settlementNoteSetAt" AS "settlementNoteSetAt",
  c."settlementNoteSetter" AS "settlementNoteSetter",
  c."openTxHash" AS "openTxHash",
  c."openLogIndex" AS "openLogIndex",
  c."updatedAt" AS "updatedAt"`;

const PASSPORT_STATUS_ORDER = `CASE p.status
  WHEN 'VERIFIED' THEN 0
  WHEN 'UNVERIFIED' THEN 1
  WHEN 'DISPUTED' THEN 2
  ELSE 3 END`;

export const BROWSE_EMPTY_RESULT = "false";

function renumberPlaceholders(sql: string, offset: number): string {
  if (offset === 0) return sql;
  return sql.replace(/\$(\d+)/g, (_, index) => `$${Number(index) + offset}`);
}

function rateLit(v: bigint | null | undefined): string {
  return v != null && v > 0n ? v.toString() : "0";
}

/**
 * SQL expression: consignment Asking → USD 1e8 (alias `c` on kargain.consignment).
 */
export function consignmentPriceUsdRawSql(rates: PartialFxRates | null): string {
  const fiatScale = FIAT_SCALE.toString();
  const nativeScale = askingAssetUsdScale(askingNativeDecimals()).toString();
  const eur = rateLit(rates?.eurUsd);
  const eth = rateLit(rates?.ethUsd);
  const cny = rateLit(rates?.cnyUsd);
  const inr = rateLit(rates?.inrUsd);
  const brl = rateLit(rates?.brlUsd);
  const idr = rateLit(rates?.idrUsd);
  const aud = rateLit(rates?.audUsd);
  const aed = rateLit(rates?.aedUsd);
  const krw = rateLit(rates?.krwUsd);
  const rub = rateLit(rates?.rubUsd);
  const jpy = rateLit(rates?.jpyUsd);

  const usdcBranches = askingUsdcFacts().map(
    (fact) =>
      `WHEN c."denominationKind" = ${DENOMINATION_KIND.Asset} AND c."chainId" = ${fact.chainId} AND lower(c.asset) = '${fact.address.toLowerCase()}' THEN (c.price * ${fiatScale}::numeric) / ${askingAssetUsdScale(fact.decimals).toString()}::numeric`,
  );

  const nativeAddr = ASKING_NATIVE_ASSET.toLowerCase();

  return `(CASE
    WHEN c.price <= 0 THEN NULL
    ${usdcBranches.join("\n    ")}
    WHEN c."denominationKind" = ${DENOMINATION_KIND.Asset}
      AND (c.asset = '' OR lower(c.asset) = '${nativeAddr}')
      AND ${eth}::numeric > 0
      THEN (c.price * ${eth}::numeric) / ${nativeScale}::numeric
    WHEN c."denominationKind" = ${DENOMINATION_KIND.Asset} THEN NULL
    WHEN upper(c."currencyCode") IN ('USD', '') THEN c.price
    WHEN upper(c."currencyCode") = 'EUR' AND ${eur}::numeric > 0
      THEN (c.price * ${eur}::numeric) / ${fiatScale}::numeric
    WHEN upper(c."currencyCode") = 'CNY' AND ${cny}::numeric > 0
      THEN (c.price * ${cny}::numeric) / ${fiatScale}::numeric
    WHEN upper(c."currencyCode") = 'INR' AND ${inr}::numeric > 0
      THEN (c.price * ${inr}::numeric) / ${fiatScale}::numeric
    WHEN upper(c."currencyCode") = 'BRL' AND ${brl}::numeric > 0
      THEN (c.price * ${brl}::numeric) / ${fiatScale}::numeric
    WHEN upper(c."currencyCode") = 'IDR' AND ${idr}::numeric > 0
      THEN (c.price * ${idr}::numeric) / ${fiatScale}::numeric
    WHEN upper(c."currencyCode") = 'AUD' AND ${aud}::numeric > 0
      THEN (c.price * ${aud}::numeric) / ${fiatScale}::numeric
    WHEN upper(c."currencyCode") = 'AED' AND ${aed}::numeric > 0
      THEN (c.price * ${aed}::numeric) / ${fiatScale}::numeric
    WHEN upper(c."currencyCode") = 'KRW' AND ${krw}::numeric > 0
      THEN (c.price * ${krw}::numeric) / ${fiatScale}::numeric
    WHEN upper(c."currencyCode") = 'RUB' AND ${rub}::numeric > 0
      THEN (c.price * ${rub}::numeric) / ${fiatScale}::numeric
    WHEN upper(c."currencyCode") = 'JPY' AND ${jpy}::numeric > 0
      THEN (c.price * ${jpy}::numeric) / ${fiatScale}::numeric
    ELSE NULL
  END)`;
}

function csvColumnMatch(
  column: string,
  selected: string[],
  params: unknown[],
): string | undefined {
  if (selected.length === 0) return undefined;
  const lowered = selected.map((s) => s.toLowerCase());
  params.push(lowered);
  return `lower(${column}) = ANY($${params.length}::text[])`;
}

export function buildBrowseFilterConditions(
  filters: ConsignmentBrowseFilters,
): { conditions: string[]; empty: boolean; rates: PartialFxRates; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const rates = parseFxRatesFromQuery(filters);

  if (filters.make) {
    params.push(filters.make.toLowerCase());
    conditions.push(`lower(p.make) = $${params.length}`);
  }
  if (filters.model) {
    params.push(filters.model.toLowerCase());
    conditions.push(`lower(p.model) = $${params.length}`);
  }
  if (filters.yearMin != null) {
    params.push(filters.yearMin);
    conditions.push(`p.year >= $${params.length}`);
  }
  if (filters.yearMax != null) {
    params.push(filters.yearMax);
    conditions.push(`p.year <= $${params.length}`);
  }
  if (filters.mileageMin != null && filters.mileageMin > 0) {
    params.push(filters.mileageMin);
    conditions.push(`p.mileage_km >= $${params.length}`);
  }
  if (filters.mileageMax != null) {
    params.push(filters.mileageMax);
    conditions.push(`p.mileage_km <= $${params.length}`);
  }
  if (filters.status && filters.status !== "all") {
    params.push(filters.status);
    conditions.push(`p.status = $${params.length}`);
  }

  const fuel = csvColumnMatch("p.fuel_type", filters.fuelTypes ?? [], params);
  if (fuel) conditions.push(fuel);
  const body = csvColumnMatch("p.body_type", filters.bodyTypes ?? [], params);
  if (body) conditions.push(body);
  const transmission = csvColumnMatch(
    "p.transmission",
    filters.transmissions ?? [],
    params,
  );
  if (transmission) conditions.push(transmission);
  const conditionCol = csvColumnMatch(
    "p.condition",
    filters.conditions ?? [],
    params,
  );
  if (conditionCol) conditions.push(conditionCol);
  const vehicle = csvColumnMatch(
    "p.vehicle_type",
    filters.vehicleTypes ?? [],
    params,
  );
  if (vehicle) conditions.push(vehicle);

  if (filters.placeId) {
    params.push(filters.placeId);
    conditions.push(`p.location_place_id = $${params.length}`);
  }
  if (filters.colour) {
    params.push(`%${filters.colour}%`);
    conditions.push(`p.colour ILIKE $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    const searchParam = `$${params.length}`;
    conditions.push(
      `(p.make ILIKE ${searchParam} OR p.model ILIKE ${searchParam} OR p.vin ILIKE ${searchParam})`,
    );
  }

  const bounds = resolveFilterBoundsUsd1e8(filters, rates);
  if (bounds === null) {
    return { conditions: [], empty: true, rates, params: [] };
  }
  if (bounds !== undefined) {
    const usd = consignmentPriceUsdRawSql(rates);
    conditions.push(`${usd} IS NOT NULL`);
    if (bounds.min != null) {
      params.push(bounds.min.toString());
      conditions.push(`${usd} >= $${params.length}::numeric`);
    }
    if (bounds.max != null) {
      params.push(bounds.max.toString());
      conditions.push(`${usd} <= $${params.length}::numeric`);
    }
  }

  return { conditions, empty: false, rates, params };
}

export function buildBrowseOrderBy(
  filters: ConsignmentBrowseFilters,
  rates: PartialFxRates,
): string[] {
  const order: string[] = [];
  if (filters.verifiedFirst) {
    order.push(PASSPORT_STATUS_ORDER);
  }

  const sort = filters.sort ?? "newest";
  const usd = consignmentPriceUsdRawSql(rates);

  switch (sort) {
    case "price_asc":
      order.push(`CASE WHEN ${usd} IS NULL THEN 1 ELSE 0 END`);
      order.push(`${usd} ASC NULLS LAST`);
      order.push(`c."openedAt" DESC`);
      break;
    case "price_desc":
      order.push(`CASE WHEN ${usd} IS NULL THEN 1 ELSE 0 END`);
      order.push(`${usd} DESC NULLS LAST`);
      order.push(`c."openedAt" DESC`);
      break;
    case "mileage_asc":
      order.push(`p.mileage_km ASC`);
      order.push(`c."openedAt" DESC`);
      break;
    default:
      order.push(`c."openedAt" DESC`);
      break;
  }

  return order;
}

function mapConsignmentRow(row: ConsignmentPgRow): ConsignmentEntityBrowseRow {
  return {
    id: row.id,
    chainId: row.chainId,
    mode: row.mode,
    modeContract: row.modeContract,
    tokenId: row.tokenId,
    saleOrdinal: row.saleOrdinal,
    seller: row.seller,
    agent: row.agent,
    asset: row.asset,
    denominationKind: row.denominationKind,
    currencyCode: row.currencyCode,
    floor: BigInt(row.floor),
    compensationForm: row.compensationForm,
    commissionBps: row.commissionBps,
    price: BigInt(row.price),
    platformFeeBps: row.platformFeeBps,
    phase: row.phase,
    closeReason: row.closeReason,
    openedAt: BigInt(row.openedAt),
    closedAt: row.closedAt != null ? BigInt(row.closedAt) : null,
    recallRequestedAt:
      row.recallRequestedAt != null ? BigInt(row.recallRequestedAt) : null,
    buyer: row.buyer,
    settlementNoteSetAt:
      row.settlementNoteSetAt != null ? BigInt(row.settlementNoteSetAt) : null,
    settlementNoteSetter: row.settlementNoteSetter,
    openTxHash: row.openTxHash,
    openLogIndex: row.openLogIndex,
    updatedAt: BigInt(row.updatedAt),
  };
}

function buildBrowseFromClause(args: {
  namespaces: readonly number[];
  includeSvmProjection: boolean;
  params: unknown[];
}): string {
  args.params.push(args.namespaces);
  const unionSubquery = buildPassportEntityUnionSubquery(
    args.namespaces,
    args.includeSvmProjection,
  );
  return `kargain.consignment c
    LEFT JOIN ${unionSubquery} p ON c."tokenId" = p.id`;
}

export function buildConsignmentBaseConditionsRaw(args: {
  mode?: string;
  active?: boolean;
  phase?: string;
  chainId?: number;
  seller?: string;
  agent?: string;
  openPhases: readonly string[];
  allPhases: ReadonlySet<string>;
}): RawBrowseSqlInput {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (args.mode === "fixedPrice" || args.mode === "ascending") {
    params.push(args.mode);
    clauses.push(`c.mode = $${params.length}`);
  }
  if (args.active === true) {
    params.push([...args.openPhases]);
    clauses.push(`c.phase = ANY($${params.length}::text[])`);
  } else if (args.active === false) {
    params.push([...args.openPhases]);
    clauses.push(`c.phase <> ALL($${params.length}::text[])`);
  }
  if (args.phase) {
    params.push(args.phase);
    clauses.push(`c.phase = $${params.length}`);
  }
  if (args.chainId !== undefined) {
    params.push(args.chainId);
    clauses.push(`c."chainId" = $${params.length}`);
  }
  if (args.seller) {
    params.push(args.seller);
    clauses.push(`c.seller = $${params.length}`);
  }
  if (args.agent) {
    params.push(args.agent);
    clauses.push(`c.agent = $${params.length}`);
  }

  return { clauses, params };
}

export async function queryConsignmentBrowseWithEntityUnion(
  pool: pg.Pool,
  filters: ConsignmentBrowseFilters,
  baseConditions: RawBrowseSqlInput,
  pagination: { limit: number; offset: number },
  opts?: PassportEntityQueryOptions,
): Promise<{
  rows: ConsignmentEntityBrowseRow[];
  total: number;
  statusCounts: ReturnType<typeof foldStatusCounts>;
}> {
  const filterResult = buildBrowseFilterConditions(filters);
  if (filterResult.empty) {
    return { rows: [], total: 0, statusCounts: emptyStatusCounts() };
  }

  const namespaces = resolveEntityNamespaces(opts);
  const params: unknown[] = [];
  const fromClause = buildBrowseFromClause({
    namespaces,
    includeSvmProjection: opts?.includeSvmProjection ?? true,
    params,
  });

  const baseOffset = params.length;
  params.push(...baseConditions.params);
  const baseClauses = baseConditions.clauses.map((clause) =>
    renumberPlaceholders(clause, baseOffset),
  );

  const filterOffset = params.length;
  params.push(...filterResult.params);
  const filterClauses = filterResult.conditions.map((clause) =>
    renumberPlaceholders(clause, filterOffset),
  );

  const whereParts = [...baseClauses, ...filterClauses];
  const whereClause =
    whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";

  const orderClauses = buildBrowseOrderBy(filters, filterResult.rates);
  const orderBy =
    orderClauses.length > 0 ? `ORDER BY ${orderClauses.join(", ")}` : "";

  const countParams = [...params];
  params.push(pagination.limit);
  const limitParam = `$${params.length}`;
  params.push(pagination.offset);
  const offsetParam = `$${params.length}`;

  const selectSql = `SELECT ${CONSIGNMENT_SELECT}
    FROM ${fromClause}
    ${whereClause}
    ${orderBy}
    LIMIT ${limitParam} OFFSET ${offsetParam}`;

  const countSql = `SELECT COUNT(*)::int AS total
    FROM ${fromClause}
    ${whereClause}`;

  const statusSql = `SELECT p.status, COUNT(*)::int AS total
    FROM ${fromClause}
    ${whereClause}
    GROUP BY p.status`;

  const [rowsRes, totalRes, statusRes] = await Promise.all([
    pool.query<ConsignmentPgRow>(selectSql, params),
    pool.query<{ total: number }>(countSql, countParams),
    pool.query<{ status: string | null; total: number }>(statusSql, countParams),
  ]);

  return {
    rows: rowsRes.rows.map(mapConsignmentRow),
    total: totalRes.rows[0]?.total ?? 0,
    statusCounts: foldStatusCounts(statusRes.rows),
  };
}
