/**
 * Sole catalog of kargain_svm_projection base tables for digest coverage.
 * Schema CREATE TABLE names, writer INSERT targets, and digest coverage must
 * stay identical — policy tests pin all three directions.
 */

export const SVM_PROJECTION_SCHEMA = "kargain_svm_projection";

export type SvmProjectionDigestKind =
  | "passport_record"
  | "passport_uri_history"
  | "custody_determining_event"
  | "passport";

export type SvmProjectionCatalogEntry = {
  /** Bare table name under kargain_svm_projection. */
  table: SvmProjectionDigestKind;
  kind: SvmProjectionDigestKind;
  selectSql: string;
  orderBySql: string;
  /** Namespace / chain filter column (all four tables use chain_id). */
  chainColumn: "chain_id";
};

/**
 * Fixed digest order. Ordering keys (by reading projection-schema.sql):
 * - passport_record / passport_uri_history: chain_id, timestamp, id
 * - custody_determining_event: no timestamp → chain_id, block_number, log_index, id
 * - passport: no timestamp → chain_id, id
 */
export const SVM_PROJECTION_CATALOG: readonly SvmProjectionCatalogEntry[] = [
  {
    table: "passport_record",
    kind: "passport_record",
    selectSql:
      "id, token_id, chain_id, author, record_type, description, evidence_cid, timestamp",
    orderBySql: "chain_id, timestamp, id",
    chainColumn: "chain_id",
  },
  {
    table: "passport_uri_history",
    kind: "passport_uri_history",
    selectSql:
      "id, token_id, chain_id, previous_uri, new_uri, author, verification_reset, timestamp",
    orderBySql: "chain_id, timestamp, id",
    chainColumn: "chain_id",
  },
  {
    table: "custody_determining_event",
    kind: "custody_determining_event",
    selectSql: "id, token_id, chain_id, kind, block_number, log_index",
    orderBySql: "chain_id, block_number, log_index, id",
    chainColumn: "chain_id",
  },
  {
    table: "passport",
    kind: "passport",
    selectSql: [
      "id",
      "chain_id",
      "entity_origin",
      "owner",
      "status",
      "verifier",
      "verified_at",
      "token_uri",
      "cover_photo_uri",
      "vin",
      "make",
      "model",
      "year",
      "mileage_km",
      "last_disputer",
      "dispute_reason",
      "dispute_withdrawn_at",
      "last_verification_reset_at",
      "duplicate_vin",
      "last_metadata_change_at",
      "verification_reset_count",
      "had_dispute",
      "last_dispute_resolved_at",
      "last_dispute_terminal",
      "dispute_opened_at",
      "fuel_type",
      "body_type",
      "transmission",
      "condition",
      "vehicle_type",
      "colour",
      "location_label",
      "location_place_id",
      "location_country_code",
      "dispute_deposit",
      "created_at",
      "updated_at",
    ].join(", "),
    orderBySql: "chain_id, id",
    chainColumn: "chain_id",
  },
] as const;

export function svmProjectionCatalogTableNames(): readonly string[] {
  return SVM_PROJECTION_CATALOG.map((e) => e.table);
}

/** Parse CREATE TABLE names from projection-schema.sql text. */
export function parseProjectionSchemaTableNames(schemaSql: string): string[] {
  const re =
    /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+kargain_svm_projection\.([a-z_]+)/gi;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(schemaSql)) !== null) {
    out.push(m[1]!);
  }
  return out;
}

export class ProjectionDigestUncoveredTableError extends Error {
  readonly uncoveredTable: string;

  constructor(uncoveredTable: string) {
    super(`projection_digest_uncovered_table: ${uncoveredTable}`);
    this.name = "ProjectionDigestUncoveredTableError";
    this.uncoveredTable = uncoveredTable;
  }
}

/**
 * Refuse if any live base table in kargain_svm_projection is absent from the catalog.
 * `liveTables` is injectable for constructed negative controls.
 */
export function assertProjectionDigestCoversTables(
  liveTables: readonly string[],
  catalogTables: readonly string[] = svmProjectionCatalogTableNames(),
): void {
  const covered = new Set(catalogTables);
  for (const table of liveTables) {
    if (!covered.has(table)) {
      throw new ProjectionDigestUncoveredTableError(table);
    }
  }
}

/** Split catalog `selectSql` into bare column names (no SELECT *). */
export function parseSelectSqlColumns(selectSql: string): string[] {
  return selectSql
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

export function catalogCoveredColumnsForTable(
  table: SvmProjectionDigestKind,
): readonly string[] {
  const entry = SVM_PROJECTION_CATALOG.find((e) => e.table === table);
  if (!entry) {
    throw new Error(`projection_digest_unknown_catalog_table: ${table}`);
  }
  return parseSelectSqlColumns(entry.selectSql);
}

export class ProjectionDigestUncoveredColumnError extends Error {
  readonly table: string;
  readonly uncoveredColumn: string;

  constructor(table: string, uncoveredColumn: string) {
    super(`projection_digest_uncovered_column: ${table}.${uncoveredColumn}`);
    this.name = "ProjectionDigestUncoveredColumnError";
    this.table = table;
    this.uncoveredColumn = uncoveredColumn;
  }
}

export class ProjectionDigestAbsentColumnError extends Error {
  readonly table: string;
  readonly absentColumn: string;

  constructor(table: string, absentColumn: string) {
    super(`projection_digest_absent_column: ${table}.${absentColumn}`);
    this.name = "ProjectionDigestAbsentColumnError";
    this.table = table;
    this.absentColumn = absentColumn;
  }
}

/**
 * Bidirectional column coverage: every live column must be in selectSql, and
 * every covered column must exist live. Injectable lists for constructed controls.
 */
export function assertProjectionDigestCoversColumns(args: {
  table: string;
  liveColumns: readonly string[];
  coveredColumns: readonly string[];
}): void {
  const covered = new Set(args.coveredColumns);
  const live = new Set(args.liveColumns);
  for (const column of args.liveColumns) {
    if (!covered.has(column)) {
      throw new ProjectionDigestUncoveredColumnError(args.table, column);
    }
  }
  for (const column of args.coveredColumns) {
    if (!live.has(column)) {
      throw new ProjectionDigestAbsentColumnError(args.table, column);
    }
  }
}
