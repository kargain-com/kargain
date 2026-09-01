/**
 * Sole SQL read owner for chain-sharded passport provenance UNION (S7c-2).
 * One statement per call — EVM Ponder tables + kargain_svm_projection.
 */

import pg from "pg";

import {
  registeredCommercialNamespaceIds,
} from "@/lib/web3/commercial-active";

export type ProvenancePassportRecord = {
  id: string;
  tokenId: string;
  chainId: number;
  author: string;
  recordType: string;
  description: string;
  evidenceCID: string;
  timestamp: bigint;
};

export type ProvenanceUriHistory = {
  id: string;
  tokenId: string;
  chainId: number;
  previousUri: string;
  newUri: string;
  author: string;
  verificationReset: boolean;
  timestamp: bigint;
};

export type AttestationRow = {
  tokenId: string;
  description: string;
  evidenceCID: string;
  timestamp: bigint;
};

export type ProvenanceQueryOptions = {
  /** Test-only override — production must use registeredCommercialNamespaceIds(). */
  namespaces?: readonly number[];
  /** Test-only: omit SVM arm for negative-control proofs. */
  includeSvmProjection?: boolean;
};

let poolSingleton: pg.Pool | null = null;

function getProvenancePool(): pg.Pool {
  if (!poolSingleton) {
    const connectionString =
      process.env.DATABASE_URL?.trim() ??
      process.env.SVM_INGEST_DATABASE_URL?.trim();
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL or SVM_INGEST_DATABASE_URL required for provenance UNION reads",
      );
    }
    poolSingleton = new pg.Pool({ connectionString });
  }
  return poolSingleton;
}

/** Visible for tests — inject pool without singleton. */
export function createProvenancePoolForTests(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString });
}

export function resolveProvenanceNamespaces(
  opts?: ProvenanceQueryOptions,
): number[] {
  if (opts?.namespaces != null) return [...opts.namespaces];
  return [...registeredCommercialNamespaceIds()];
}

function mapRecordRow(row: {
  id: string;
  token_id: string;
  chain_id: number;
  author: string;
  record_type: string;
  description: string;
  evidence_cid: string;
  timestamp: string;
}): ProvenancePassportRecord {
  return {
    id: row.id,
    tokenId: row.token_id,
    chainId: row.chain_id,
    author: row.author,
    recordType: row.record_type,
    description: row.description,
    evidenceCID: row.evidence_cid,
    timestamp: BigInt(row.timestamp),
  };
}

function mapUriRow(row: {
  id: string;
  token_id: string;
  chain_id: number;
  previous_uri: string;
  new_uri: string;
  author: string;
  verification_reset: boolean;
  timestamp: string;
}): ProvenanceUriHistory {
  return {
    id: row.id,
    tokenId: row.token_id,
    chainId: row.chain_id,
    previousUri: row.previous_uri,
    newUri: row.new_uri,
    author: row.author,
    verificationReset: row.verification_reset,
    timestamp: BigInt(row.timestamp),
  };
}

export function buildUnionPassportRecordsSql(args: {
  tokenId?: string;
  author?: string;
  recordType?: string;
  namespaces: readonly number[];
  includeSvmProjection: boolean;
  limit?: number;
  offset?: number;
}): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const evmWhere: string[] = [];
  const svmWhere: string[] = [];

  if (args.tokenId != null) {
    params.push(args.tokenId);
    evmWhere.push(`token_id = $${params.length}`);
    svmWhere.push(`token_id = $${params.length}`);
  }
  if (args.author != null) {
    params.push(args.author);
    evmWhere.push(`author = $${params.length}`);
    svmWhere.push(`author = $${params.length}`);
  }
  if (args.recordType != null) {
    params.push(args.recordType);
    evmWhere.push(`record_type = $${params.length}`);
    svmWhere.push(`record_type = $${params.length}`);
  }

  params.push(args.namespaces);
  const nsParam = `$${params.length}`;
  evmWhere.push(`chain_id = ANY(${nsParam}::int[])`);
  svmWhere.push(`chain_id = ANY(${nsParam}::int[])`);

  const evmClause = `SELECT id, token_id, chain_id, author, record_type, description, evidence_cid, timestamp
    FROM kargain.passport_record
    ${evmWhere.length ? `WHERE ${evmWhere.join(" AND ")}` : ""}`;

  const parts = [evmClause];
  if (args.includeSvmProjection) {
    parts.push(
      `SELECT id, token_id, chain_id, author, record_type, description, evidence_cid, timestamp
       FROM kargain_svm_projection.passport_record
       ${svmWhere.length ? `WHERE ${svmWhere.join(" AND ")}` : ""}`,
    );
  }

  let sql = `SELECT * FROM (${parts.join(" UNION ALL ")}) AS provenance_union
    ORDER BY timestamp DESC, id DESC`;

  if (args.limit != null) {
    params.push(args.limit);
    sql += ` LIMIT $${params.length}`;
  }
  if (args.offset != null) {
    params.push(args.offset);
    sql += ` OFFSET $${params.length}`;
  }

  return { sql, params };
}

export function buildUnionUriHistorySql(args: {
  tokenId: string;
  namespaces: readonly number[];
  includeSvmProjection: boolean;
}): { sql: string; params: unknown[] } {
  const params: unknown[] = [args.tokenId];
  const tokenParam = `$1`;
  params.push(args.namespaces);
  const nsParam = `$2`;

  const evmClause = `SELECT id, token_id, chain_id, previous_uri, new_uri, author, verification_reset, timestamp
    FROM kargain.passport_uri_history
    WHERE token_id = ${tokenParam} AND chain_id = ANY(${nsParam}::int[])`;

  const parts = [evmClause];
  if (args.includeSvmProjection) {
    parts.push(
      `SELECT id, token_id, chain_id, previous_uri, new_uri, author, verification_reset, timestamp
       FROM kargain_svm_projection.passport_uri_history
       WHERE token_id = ${tokenParam} AND chain_id = ANY(${nsParam}::int[])`,
    );
  }

  const sql = `SELECT * FROM (${parts.join(" UNION ALL ")}) AS provenance_union
    ORDER BY timestamp DESC, id DESC`;
  return { sql, params };
}

export async function loadPassportRecordsByTokenId(
  tokenId: string,
  opts?: ProvenanceQueryOptions,
  pool: pg.Pool = getProvenancePool(),
): Promise<ProvenancePassportRecord[]> {
  const namespaces = resolveProvenanceNamespaces(opts);
  const { sql, params } = buildUnionPassportRecordsSql({
    tokenId,
    namespaces,
    includeSvmProjection: opts?.includeSvmProjection ?? true,
  });
  const res = await pool.query(sql, params);
  return res.rows.map(mapRecordRow);
}

export async function loadPassportUriHistoryByTokenId(
  tokenId: string,
  opts?: ProvenanceQueryOptions,
  pool: pg.Pool = getProvenancePool(),
): Promise<ProvenanceUriHistory[]> {
  const namespaces = resolveProvenanceNamespaces(opts);
  const { sql, params } = buildUnionUriHistorySql({
    tokenId,
    namespaces,
    includeSvmProjection: opts?.includeSvmProjection ?? true,
  });
  const res = await pool.query(sql, params);
  return res.rows.map(mapUriRow);
}

export async function loadAttestationsByAuthor(
  author: string,
  args: { limit: number; offset: number } & ProvenanceQueryOptions,
  pool: pg.Pool = getProvenancePool(),
): Promise<AttestationRow[]> {
  const namespaces = resolveProvenanceNamespaces(args);
  const { sql, params } = buildUnionPassportRecordsSql({
    author,
    recordType: "attestation",
    namespaces,
    includeSvmProjection: args.includeSvmProjection ?? true,
    limit: args.limit,
    offset: args.offset,
  });
  const res = await pool.query(sql, params);
  return res.rows.map((row) => ({
    tokenId: row.token_id,
    description: row.description,
    evidenceCID: row.evidence_cid,
    timestamp: BigInt(row.timestamp),
  }));
}

export async function countAttestationsByAuthor(
  author: string,
  opts?: ProvenanceQueryOptions,
  pool: pg.Pool = getProvenancePool(),
): Promise<number> {
  const namespaces = resolveProvenanceNamespaces(opts);
  const { sql, params } = buildUnionPassportRecordsSql({
    author,
    recordType: "attestation",
    namespaces,
    includeSvmProjection: opts?.includeSvmProjection ?? true,
  });
  const res = await pool.query(
    `SELECT COUNT(*)::int AS total FROM (${sql}) AS counted`,
    params,
  );
  return res.rows[0]?.total ?? 0;
}

export function naiveMergeAttestations(
  evmRows: AttestationRow[],
  svmRows: AttestationRow[],
  limit: number,
  offset: number,
): AttestationRow[] {
  const sortDesc = (rows: AttestationRow[]) =>
    rows.slice().sort((a, b) => (a.timestamp > b.timestamp ? -1 : 1));
  const evmPage = sortDesc(evmRows).slice(offset, offset + limit);
  const svmPage = sortDesc(svmRows).slice(offset, offset + limit);
  return sortDesc([...evmPage, ...svmPage]).slice(0, limit);
}
