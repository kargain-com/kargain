/**
 * Chain-free canonical digest of kargain_svm_projection rows (S7c-2 rebuild proof).
 */

import { createHash } from "node:crypto";
import type pg from "pg";

export type PassportRecordProjectionRow = {
  id: string;
  token_id: string;
  chain_id: number;
  author: string;
  record_type: string;
  description: string;
  evidence_cid: string;
  timestamp: string;
};

export type PassportUriHistoryProjectionRow = {
  id: string;
  token_id: string;
  chain_id: number;
  previous_uri: string;
  new_uri: string;
  author: string;
  verification_reset: boolean;
  timestamp: string;
};

function canonicalRecordLine(row: PassportRecordProjectionRow): string {
  return JSON.stringify({
    kind: "passport_record",
    id: row.id,
    token_id: row.token_id,
    chain_id: row.chain_id,
    author: row.author,
    record_type: row.record_type,
    description: row.description,
    evidence_cid: row.evidence_cid,
    timestamp: row.timestamp,
  });
}

function canonicalUriLine(row: PassportUriHistoryProjectionRow): string {
  return JSON.stringify({
    kind: "passport_uri_history",
    id: row.id,
    token_id: row.token_id,
    chain_id: row.chain_id,
    previous_uri: row.previous_uri,
    new_uri: row.new_uri,
    author: row.author,
    verification_reset: row.verification_reset,
    timestamp: row.timestamp,
  });
}

export async function fetchProjectionRowsOrdered(
  pool: pg.Pool,
  namespace?: number,
): Promise<{ records: PassportRecordProjectionRow[]; uriHistory: PassportUriHistoryProjectionRow[] }> {
  const where = namespace != null ? "WHERE chain_id = $1" : "";
  const params = namespace != null ? [namespace] : [];

  const [recordsRes, uriRes] = await Promise.all([
    pool.query<PassportRecordProjectionRow>(
      `SELECT id, token_id, chain_id, author, record_type, description, evidence_cid, timestamp
       FROM kargain_svm_projection.passport_record
       ${where}
       ORDER BY chain_id, timestamp, id`,
      params,
    ),
    pool.query<PassportUriHistoryProjectionRow>(
      `SELECT id, token_id, chain_id, previous_uri, new_uri, author, verification_reset, timestamp
       FROM kargain_svm_projection.passport_uri_history
       ${where}
       ORDER BY chain_id, timestamp, id`,
      params,
    ),
  ]);

  return { records: recordsRes.rows, uriHistory: uriRes.rows };
}

export function digestProjectionRows(args: {
  records: readonly PassportRecordProjectionRow[];
  uriHistory: readonly PassportUriHistoryProjectionRow[];
}): string {
  const hash = createHash("sha256");
  for (const row of args.records) {
    hash.update(canonicalRecordLine(row));
    hash.update("\n");
  }
  for (const row of args.uriHistory) {
    hash.update(canonicalUriLine(row));
    hash.update("\n");
  }
  return hash.digest("hex");
}

export async function projectionReplayDigestFromPool(
  pool: pg.Pool,
  namespace?: number,
): Promise<{ digest: string; recordCount: number; uriCount: number }> {
  const { records, uriHistory } = await fetchProjectionRowsOrdered(pool, namespace);
  return {
    digest: digestProjectionRows({ records, uriHistory }),
    recordCount: records.length,
    uriCount: uriHistory.length,
  };
}
