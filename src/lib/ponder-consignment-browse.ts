/**
 * Sole owner of `/consignments` browse filter + sort SQL predicates.
 * Pure parse/bounds: `lib/marketplace/consignment-browse-filters.ts`.
 */

import { consignment, passport } from "ponder:schema";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  or,
  sql,
  type SQL,
} from "ponder";

import { DENOMINATION_KIND } from "../../lib/commerce/denomination";
import {
  ASKING_NATIVE_ASSET,
  askingAssetUsdScale,
  askingNativeDecimals,
  askingUsdcFacts,
} from "../../lib/commerce/listing-price-display";
import {
  parseConsignmentBrowseFilters,
  parseFxRatesFromQuery,
  resolveFilterBoundsUsd1e8,
  type ConsignmentBrowseFilters,
} from "../../lib/marketplace/consignment-browse-filters";
import {
  FIAT_SCALE,
  type PartialFxRates,
} from "../../lib/marketplace/price-normalize";

export {
  parseConsignmentBrowseFilters,
  resolveFilterBoundsUsd1e8,
  splitCsvFilter,
  type ConsignmentBrowseFilters,
  type PriceBoundsUsd1e8,
} from "../../lib/marketplace/consignment-browse-filters";

export {
  PASSPORT_BROWSE_INDEXES,
  PASSPORT_BROWSE_UNINDEXED_ILIKE,
} from "./passport-browse-index-contract";

/** Empty / impossible predicate — used when FX conversion fail-closes. */
export const BROWSE_EMPTY_RESULT = sql`false`;

function csvColumnMatch(
  column: typeof passport.fuelType,
  selected: string[],
): SQL | undefined {
  if (selected.length === 0) return undefined;
  const lowered = selected.map((s) => s.toLowerCase());
  return inArray(sql`lower(${column})`, lowered);
}

/**
 * SQL expression: consignment Asking → USD 1e8.
 * Asset conversion facts come from listing-price-display (USDC peg, native ETH).
 * Unknown Asset / unpriced / missing rate → NULL.
 */
export function consignmentPriceUsdSql(rates: PartialFxRates | null): SQL {
  const fiatScale = FIAT_SCALE.toString();
  const nativeScale = askingAssetUsdScale(askingNativeDecimals()).toString();
  const rateLit = (v: bigint | null | undefined) =>
    v != null && v > 0n ? v.toString() : "0";

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

  const usdcBranches = askingUsdcFacts().map((fact) => {
    const assetScale = askingAssetUsdScale(fact.decimals).toString();
    return sql`WHEN ${consignment.denominationKind} = ${DENOMINATION_KIND.Asset} AND ${consignment.chainId} = ${fact.chainId} AND lower(${consignment.asset}) = ${fact.address.toLowerCase()} THEN (${consignment.price} * ${sql.raw(fiatScale)}::numeric) / ${sql.raw(assetScale)}::numeric`;
  });

  const nativeAddr = ASKING_NATIVE_ASSET.toLowerCase();

  return sql`(CASE
    WHEN ${consignment.price} <= 0 THEN NULL
    ${sql.join(usdcBranches, sql` `)}
    WHEN ${consignment.denominationKind} = ${DENOMINATION_KIND.Asset}
      AND (${consignment.asset} = ${""} OR lower(${consignment.asset}) = ${nativeAddr})
      AND ${sql.raw(eth)}::numeric > 0
      THEN (${consignment.price} * ${sql.raw(eth)}::numeric) / ${sql.raw(nativeScale)}::numeric
    WHEN ${consignment.denominationKind} = ${DENOMINATION_KIND.Asset} THEN NULL
    WHEN upper(${consignment.currencyCode}) IN ('USD', '') THEN ${consignment.price}
    WHEN upper(${consignment.currencyCode}) = 'EUR' AND ${sql.raw(eur)}::numeric > 0
      THEN (${consignment.price} * ${sql.raw(eur)}::numeric) / ${sql.raw(fiatScale)}::numeric
    WHEN upper(${consignment.currencyCode}) = 'CNY' AND ${sql.raw(cny)}::numeric > 0
      THEN (${consignment.price} * ${sql.raw(cny)}::numeric) / ${sql.raw(fiatScale)}::numeric
    WHEN upper(${consignment.currencyCode}) = 'INR' AND ${sql.raw(inr)}::numeric > 0
      THEN (${consignment.price} * ${sql.raw(inr)}::numeric) / ${sql.raw(fiatScale)}::numeric
    WHEN upper(${consignment.currencyCode}) = 'BRL' AND ${sql.raw(brl)}::numeric > 0
      THEN (${consignment.price} * ${sql.raw(brl)}::numeric) / ${sql.raw(fiatScale)}::numeric
    WHEN upper(${consignment.currencyCode}) = 'IDR' AND ${sql.raw(idr)}::numeric > 0
      THEN (${consignment.price} * ${sql.raw(idr)}::numeric) / ${sql.raw(fiatScale)}::numeric
    WHEN upper(${consignment.currencyCode}) = 'AUD' AND ${sql.raw(aud)}::numeric > 0
      THEN (${consignment.price} * ${sql.raw(aud)}::numeric) / ${sql.raw(fiatScale)}::numeric
    WHEN upper(${consignment.currencyCode}) = 'AED' AND ${sql.raw(aed)}::numeric > 0
      THEN (${consignment.price} * ${sql.raw(aed)}::numeric) / ${sql.raw(fiatScale)}::numeric
    WHEN upper(${consignment.currencyCode}) = 'KRW' AND ${sql.raw(krw)}::numeric > 0
      THEN (${consignment.price} * ${sql.raw(krw)}::numeric) / ${sql.raw(fiatScale)}::numeric
    WHEN upper(${consignment.currencyCode}) = 'RUB' AND ${sql.raw(rub)}::numeric > 0
      THEN (${consignment.price} * ${sql.raw(rub)}::numeric) / ${sql.raw(fiatScale)}::numeric
    WHEN upper(${consignment.currencyCode}) = 'JPY' AND ${sql.raw(jpy)}::numeric > 0
      THEN (${consignment.price} * ${sql.raw(jpy)}::numeric) / ${sql.raw(fiatScale)}::numeric
    ELSE NULL
  END)`;
}

export const PASSPORT_STATUS_ORDER = sql`CASE ${passport.status}
  WHEN 'VERIFIED' THEN 0
  WHEN 'UNVERIFIED' THEN 1
  WHEN 'DISPUTED' THEN 2
  ELSE 3 END`;

/**
 * Build filter predicates that require the passport join.
 * Returns `{ empty: true }` when price bounds were requested but FX failed.
 */
export function buildBrowseFilterConditions(
  filters: ConsignmentBrowseFilters,
): { conditions: SQL[]; empty: boolean; rates: PartialFxRates } {
  const conditions: SQL[] = [];
  const rates = parseFxRatesFromQuery(filters);

  if (filters.make) {
    conditions.push(sql`lower(${passport.make}) = ${filters.make.toLowerCase()}`);
  }
  if (filters.model) {
    conditions.push(sql`lower(${passport.model}) = ${filters.model.toLowerCase()}`);
  }
  if (filters.yearMin != null) {
    conditions.push(gte(passport.year, filters.yearMin));
  }
  if (filters.yearMax != null) {
    conditions.push(lte(passport.year, filters.yearMax));
  }
  if (filters.mileageMin != null && filters.mileageMin > 0) {
    conditions.push(gte(passport.mileageKm, filters.mileageMin));
  }
  if (filters.mileageMax != null) {
    conditions.push(lte(passport.mileageKm, filters.mileageMax));
  }
  if (filters.status && filters.status !== "all") {
    conditions.push(eq(passport.status, filters.status));
  }

  const fuel = csvColumnMatch(passport.fuelType, filters.fuelTypes ?? []);
  if (fuel) conditions.push(fuel);
  const body = csvColumnMatch(passport.bodyType, filters.bodyTypes ?? []);
  if (body) conditions.push(body);
  const transmission = csvColumnMatch(
    passport.transmission,
    filters.transmissions ?? [],
  );
  if (transmission) conditions.push(transmission);
  const conditionCol = csvColumnMatch(
    passport.condition,
    filters.conditions ?? [],
  );
  if (conditionCol) conditions.push(conditionCol);
  const vehicle = csvColumnMatch(
    passport.vehicleType,
    filters.vehicleTypes ?? [],
  );
  if (vehicle) conditions.push(vehicle);

  if (filters.placeId) {
    conditions.push(eq(passport.locationPlaceId, filters.placeId));
  }
  if (filters.colour) {
    conditions.push(ilike(passport.colour, `%${filters.colour}%`));
  }
  if (filters.search) {
    const q = `%${filters.search}%`;
    conditions.push(
      or(
        ilike(passport.make, q),
        ilike(passport.model, q),
        ilike(passport.vin, q),
      )!,
    );
  }

  const bounds = resolveFilterBoundsUsd1e8(filters, rates);
  if (bounds === null) {
    return { conditions: [], empty: true, rates };
  }
  if (bounds !== undefined) {
    const usd = consignmentPriceUsdSql(rates);
    conditions.push(sql`${usd} IS NOT NULL`);
    if (bounds.min != null) {
      conditions.push(sql`${usd} >= ${bounds.min.toString()}::numeric`);
    }
    if (bounds.max != null) {
      conditions.push(sql`${usd} <= ${bounds.max.toString()}::numeric`);
    }
  }

  return { conditions, empty: false, rates };
}

export function buildBrowseOrderBy(
  filters: ConsignmentBrowseFilters,
  rates: PartialFxRates,
): SQL[] {
  const order: SQL[] = [];
  if (filters.verifiedFirst) {
    order.push(PASSPORT_STATUS_ORDER);
  }

  const sort = filters.sort ?? "newest";
  const usd = consignmentPriceUsdSql(rates);

  switch (sort) {
    case "price_asc":
      order.push(sql`CASE WHEN ${usd} IS NULL THEN 1 ELSE 0 END`);
      order.push(sql`${usd} ASC NULLS LAST`);
      order.push(desc(consignment.openedAt));
      break;
    case "price_desc":
      order.push(sql`CASE WHEN ${usd} IS NULL THEN 1 ELSE 0 END`);
      order.push(sql`${usd} DESC NULLS LAST`);
      order.push(desc(consignment.openedAt));
      break;
    case "mileage_asc":
      order.push(asc(passport.mileageKm));
      order.push(desc(consignment.openedAt));
      break;
    default:
      order.push(desc(consignment.openedAt));
      break;
  }

  return order;
}

export function emptyStatusCounts(): {
  UNVERIFIED: number;
  VERIFIED: number;
  DISPUTED: number;
} {
  return { UNVERIFIED: 0, VERIFIED: 0, DISPUTED: 0 };
}

export function foldStatusCounts(
  rows: Array<{ status: string | null; total: number | bigint | string }>,
): { UNVERIFIED: number; VERIFIED: number; DISPUTED: number } {
  const statusCounts = emptyStatusCounts();
  for (const row of rows) {
    const status = row.status ?? "UNVERIFIED";
    if (status in statusCounts) {
      statusCounts[status as keyof typeof statusCounts] += Number(row.total);
    }
  }
  return statusCounts;
}

/** Combine base commerce predicates with browse filter predicates. */
export function mergeBrowseWhere(
  base: SQL[],
  filterResult: { conditions: SQL[]; empty: boolean },
): SQL | undefined {
  if (filterResult.empty) return BROWSE_EMPTY_RESULT;
  const all = [...base, ...filterResult.conditions];
  if (all.length === 0) return undefined;
  return and(...all);
}
