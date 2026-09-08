/**
 * Chain-free canonical digest of all kargain_svm_projection tables (S7c rebuild proof).
 * Coverage is refused by name when a live projection table is missing from the catalog.
 */

import { createHash } from "node:crypto";
import type pg from "pg";

import {
  SVM_PROJECTION_CATALOG,
  SVM_PROJECTION_SCHEMA,
  assertProjectionDigestCoversTables,
  type SvmProjectionDigestKind,
} from "./svm-projection-catalog.js";

export type ProjectionDigestCounts = Record<SvmProjectionDigestKind, number>;

export type ProjectionReplayDigestResult = {
  digest: string;
  countsByKind: ProjectionDigestCounts;
  coveredTables: readonly string[];
};

function emptyCounts(): ProjectionDigestCounts {
  return {
    passport_record: 0,
    passport_uri_history: 0,
    custody_determining_event: 0,
    passport: 0,
  };
}

function canonicalLine(
  kind: SvmProjectionDigestKind,
  row: Record<string, unknown>,
): string {
  return JSON.stringify({ kind, ...normalizeRow(row) });
}

/** Stable JSON: bigint-ish strings stay strings; Buffer never appears from text/int cols. */
function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === "bigint") {
      out[k] = v.toString();
    } else if (v != null && typeof v === "object" && !Array.isArray(v)) {
      // pg may return Date — should not for these columns; stringify unknowns
      out[k] = v;
    } else {
      out[k] = v;
    }
  }
  return out;
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

export async function assertProjectionDigestCoversLiveSchema(
  pool: pg.Pool,
): Promise<string[]> {
  const live = await listLiveProjectionBaseTables(pool);
  assertProjectionDigestCoversTables(live);
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
