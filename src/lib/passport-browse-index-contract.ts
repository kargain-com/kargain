/**
 * Contract: every passport index in ponder.schema.ts must match a browse
 * predicate/order key. Pure data — no Ponder schema import (tests + docs).
 */

export const PASSPORT_BROWSE_INDEXES = [
  {
    schemaKey: "statusIdx",
    form: "column" as const,
    column: "status",
    serves: "eq(passport.status) / statusCounts groupBy (verifiedFirst uses CASE, not this btree)",
  },
  {
    schemaKey: "makeIdx",
    form: "lower" as const,
    column: "make",
    serves: "lower(make) = ? (buildBrowseFilterConditions)",
  },
  {
    schemaKey: "modelIdx",
    form: "lower" as const,
    column: "model",
    serves: "lower(model) = ? (buildBrowseFilterConditions)",
  },
  {
    schemaKey: "yearIdx",
    form: "column" as const,
    column: "year",
    serves: "gte/lte(passport.year) yearMin/yearMax",
  },
  {
    schemaKey: "mileageIdx",
    form: "column" as const,
    column: "mileageKm",
    serves: "gte/lte(mileageKm) + ORDER BY mileage_asc",
  },
  {
    schemaKey: "placeIdx",
    form: "column" as const,
    column: "locationPlaceId",
    serves: "eq(passport.locationPlaceId) placeId=",
  },
  {
    schemaKey: "fuelIdx",
    form: "lower" as const,
    column: "fuelType",
    serves: "csvColumnMatch → lower(fuelType) IN (…)",
  },
  {
    schemaKey: "bodyIdx",
    form: "lower" as const,
    column: "bodyType",
    serves: "csvColumnMatch → lower(bodyType) IN (…)",
  },
  {
    schemaKey: "transmissionIdx",
    form: "lower" as const,
    column: "transmission",
    serves: "csvColumnMatch → lower(transmission) IN (…)",
  },
  {
    schemaKey: "conditionIdx",
    form: "lower" as const,
    column: "condition",
    serves: "csvColumnMatch → lower(condition) IN (…)",
  },
  {
    schemaKey: "vehicleIdx",
    form: "lower" as const,
    column: "vehicleType",
    serves: "csvColumnMatch → lower(vehicleType) IN (…)",
  },
] as const;

/** Passport filters with leading-wildcard ILIKE — no btree index. */
export const PASSPORT_BROWSE_UNINDEXED_ILIKE = ["colour", "search"] as const;
