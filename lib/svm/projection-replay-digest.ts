/**
 * Chain-free canonical digest of all kargain_svm_projection tables (S7c rebuild proof).
 * Table and column coverage refuse by name against live information_schema;
 * canonical keys are lexicographic so selectSql / driver order cannot drift digests.
 */

import { createHash } from "node:crypto";
import type pg from "pg";

import {
  SVM_PROJECTION_CATALOG,
  SVM_PROJECTION_SCHEMA,
  assertProjectionDigestCoversColumns,
  assertProjectionDigestCoversTables,
  parseSelectSqlColumns,
  type SvmProjectionDigestKind,
} from "./svm-projection-catalog.js";

export type ProjectionDigestCounts = Record<SvmProjectionDigestKind, number>;

export type ProjectionReplayDigestResult = {
  digest: string;
  countsByKind: ProjectionDigestCounts;
  coveredTables: readonly string[];
};

export class ProjectionDigestUndefinedValueTypeError extends Error {
  readonly column: string;
  readonly jsType: string;

  constructor(column: string, jsType: string) {
    super(`projection_digest_undefined_value_type: ${column}:${jsType}`);
    this.name = "ProjectionDigestUndefinedValueTypeError";
    this.column = column;
    this.jsType = jsType;
  }
}

function emptyCounts(): ProjectionDigestCounts {
  return {
    passport_record: 0,
    passport_uri_history: 0,
    custody_determining_event: 0,
    passport: 0,
  };
}

function jsTypeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (value instanceof Date) return "Date";
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) return "Buffer";
  return typeof value;
}

/**
 * Canonical cell types for today's projection schema (TEXT/INTEGER/BIGINT/BOOLEAN)
 * under node-pg defaults: null | string | number | boolean. bigint → string.
 */
export function normalizeCanonicalValue(
  column: string,
  value: unknown,
): string | number | boolean | null {
  if (value === null) return null;
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") {
    return value as string | number | boolean;
  }
  if (t === "bigint") {
    return (value as bigint).toString();
  }
  throw new ProjectionDigestUndefinedValueTypeError(column, jsTypeName(value));
}

/**
 * Lexicographic ascending column keys (localeCompare, numeric: false).
 * Shape is `{ kind, row }` — `kind` is the stream discriminant (catalog table);
 * columns live under `row` so a live column also named `kind` (custody) cannot
 * overwrite the discriminant (latent collision in the prior flat spread).
 */
export function canonicalizeProjectionRow(
  kind: SvmProjectionDigestKind,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const keys = Object.keys(row).sort((a, b) =>
    a.localeCompare(b, "en", { numeric: false }),
  );
  const fields: Record<string, unknown> = {};
  for (const key of keys) {
    fields[key] = normalizeCanonicalValue(key, row[key]);
  }
  return { kind, row: fields };
}

export function canonicalLine(
  kind: SvmProjectionDigestKind,
  row: Record<string, unknown>,
): string {
  return JSON.stringify(canonicalizeProjectionRow(kind, row));
}

export async function listLiveProjectionBaseTables(
  pool: pg.Pool,
): Promise<string[]> {
  const res = await pool.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = $1
       AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
    [SVM_PROJECTION_SCHEMA],
  );
  return res.rows.map((r) => r.table_name);
}

export async function listLiveProjectionColumns(
  pool: pg.Pool,
  table: string,
): Promise<string[]> {
  const res = await pool.query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = $1
       AND table_name = $2
     ORDER BY ordinal_position`,
    [SVM_PROJECTION_SCHEMA, table],
  );
  return res.rows.map((r) => r.column_name);
}

export async function assertProjectionDigestCoversLiveSchema(
  pool: pg.Pool,
): Promise<string[]> {
  const live = await listLiveProjectionBaseTables(pool);
  assertProjectionDigestCoversTables(live);
  for (const entry of SVM_PROJECTION_CATALOG) {
    const liveColumns = await listLiveProjectionColumns(pool, entry.table);
    assertProjectionDigestCoversColumns({
      table: entry.table,
      liveColumns,
      coveredColumns: parseSelectSqlColumns(entry.selectSql),
    });
  }
  return live;
}

export async function fetchProjectionTableRowsOrdered(
  pool: pg.Pool,
  entry: (typeof SVM_PROJECTION_CATALOG)[number],
  namespace?: number,
): Promise<Record<string, unknown>[]> {
  const where =
    namespace != null ? `WHERE ${entry.chainColumn} = $1` : "";
  const params = namespace != null ? [namespace] : [];
  const sql = `SELECT ${entry.selectSql}
    FROM ${SVM_PROJECTION_SCHEMA}.${entry.table}
    ${where}
    ORDER BY ${entry.orderBySql}`;
  const res = await pool.query(sql, params);
  return res.rows as Record<string, unknown>[];
}

export function digestProjectionCatalogRows(
  streams: readonly {
    kind: SvmProjectionDigestKind;
    rows: readonly Record<string, unknown>[];
  }[],
): string {
  const hash = createHash("sha256");
  for (const stream of streams) {
    for (const row of stream.rows) {
      hash.update(canonicalLine(stream.kind, row));
      hash.update("\n");
    }
  }
  return hash.digest("hex");
}

export async function projectionReplayDigestFromPool(
  pool: pg.Pool,
  namespace?: number,
): Promise<ProjectionReplayDigestResult> {
  const live = await assertProjectionDigestCoversLiveSchema(pool);
  const countsByKind = emptyCounts();
  const streams: {
    kind: SvmProjectionDigestKind;
    rows: Record<string, unknown>[];
  }[] = [];

  for (const entry of SVM_PROJECTION_CATALOG) {
    const rows = await fetchProjectionTableRowsOrdered(pool, entry, namespace);
    countsByKind[entry.kind] = rows.length;
    streams.push({ kind: entry.kind, rows });
  }

  return {
    digest: digestProjectionCatalogRows(streams),
    countsByKind,
    coveredTables: live,
  };
}
