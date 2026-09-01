/**
 * Sole SQL read owner for chain-sharded passport entity UNION (S7c-4).
 * One statement per call — EVM Ponder tables + kargain_svm_projection.
 */

import pg from "pg";
import { getAddress } from "viem";

import {
  registeredCommercialNamespaceIds,
} from "@/lib/web3/commercial-active";

export type PassportEntityRow = {
  id: string;
  chainId: number;
  owner: string;
  status: string;
  verifier: string;
  verifiedAt: bigint;
  tokenUri: string;
  coverPhotoUri: string;
  vin: string;
  make: string;
  model: string;
  year: number;
  mileageKm: number;
  lastDisputer: string;
  disputeReason: string;
  disputeWithdrawnAt: bigint;
  lastVerificationResetAt: bigint;
  duplicateVin: boolean;
  lastMetadataChangeAt: bigint;
  verificationResetCount: number;
  hadDispute: boolean;
  lastDisputeResolvedAt: bigint;
  lastDisputeTerminal: string;
  disputeOpenedAt: bigint;
  fuelType: string;
  bodyType: string;
  transmission: string;
  condition: string;
  vehicleType: string;
  colour: string;
  locationLabel: string;
  locationPlaceId: string;
  locationCountryCode: string;
  disputeDeposit: bigint | null;
  createdAt: bigint;
  updatedAt: bigint;
};

export type PassportEntityQueryOptions = {
  /** Test-only override — production must use registeredCommercialNamespaceIds(). */
  namespaces?: readonly number[];
  /** Test-only: omit SVM arm for negative-control proofs. */
  includeSvmProjection?: boolean;
};

export type PassportEntityBrowseFilters = {
  owner?: string;
  status?: string;
  vin?: string;
  verifier?: string;
  verifiedFirst?: boolean;
  limit: number;
  offset: number;
};

export type VerifierVerificationCountRow = {
  verifier: string;
  total: number;
};

const PASSPORT_ENTITY_EVM_SELECT = `SELECT
  id,
  "chainId" AS chain_id,
  owner,
  status,
  verifier,
  "verifiedAt" AS verified_at,
  "tokenUri" AS token_uri,
  "coverPhotoUri" AS cover_photo_uri,
  vin,
  make,
  model,
  year,
  "mileageKm" AS mileage_km,
  "lastDisputer" AS last_disputer,
  "disputeReason" AS dispute_reason,
  "disputeWithdrawnAt" AS dispute_withdrawn_at,
  "lastVerificationResetAt" AS last_verification_reset_at,
  "duplicateVin" AS duplicate_vin,
  "lastMetadataChangeAt" AS last_metadata_change_at,
  "verificationResetCount" AS verification_reset_count,
  "hadDispute" AS had_dispute,
  "lastDisputeResolvedAt" AS last_dispute_resolved_at,
  "lastDisputeTerminal" AS last_dispute_terminal,
  "disputeOpenedAt" AS dispute_opened_at,
  "fuelType" AS fuel_type,
  "bodyType" AS body_type,
  transmission,
  condition,
  "vehicleType" AS vehicle_type,
  colour,
  "locationLabel" AS location_label,
  "locationPlaceId" AS location_place_id,
  "locationCountryCode" AS location_country_code,
  "disputeDeposit" AS dispute_deposit,
  "createdAt" AS created_at,
  "updatedAt" AS updated_at
FROM kargain.passport`;

const PASSPORT_ENTITY_SVM_SELECT = `SELECT
  id,
  chain_id,
  owner,
  status,
  verifier,
  verified_at,
  token_uri,
  cover_photo_uri,
  vin,
  make,
  model,
  year,
  mileage_km,
  last_disputer,
  dispute_reason,
  dispute_withdrawn_at,
  last_verification_reset_at,
  duplicate_vin,
  last_metadata_change_at,
  verification_reset_count,
  had_dispute,
  last_dispute_resolved_at,
  last_dispute_terminal,
  dispute_opened_at,
  fuel_type,
  body_type,
  transmission,
  condition,
  vehicle_type,
  colour,
  location_label,
  location_place_id,
  location_country_code,
  dispute_deposit,
  created_at,
  updated_at
FROM kargain_svm_projection.passport`;

const PASSPORT_STATUS_ORDER_SQL = `CASE status
  WHEN 'VERIFIED' THEN 0
  WHEN 'UNVERIFIED' THEN 1
  WHEN 'DISPUTED' THEN 2
  ELSE 3 END`;

let poolSingleton: pg.Pool | null = null;

export function getEntityPool(): pg.Pool {
  if (!poolSingleton) {
    const connectionString =
      process.env.DATABASE_URL?.trim() ??
      process.env.SVM_INGEST_DATABASE_URL?.trim();
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL or SVM_INGEST_DATABASE_URL required for passport entity UNION reads",
      );
    }
    poolSingleton = new pg.Pool({ connectionString });
  }
  return poolSingleton;
}

export function resolveEntityNamespaces(
  opts?: PassportEntityQueryOptions,
): number[] {
  if (opts?.namespaces != null) return [...opts.namespaces];
  return [...registeredCommercialNamespaceIds()];
}

type PassportEntityPgRow = {
  id: string;
  chain_id: number;
  owner: string;
  status: string;
  verifier: string;
  verified_at: string;
  token_uri: string;
  cover_photo_uri: string;
  vin: string;
  make: string;
  model: string;
  year: number;
  mileage_km: number;
  last_disputer: string;
  dispute_reason: string;
  dispute_withdrawn_at: string;
  last_verification_reset_at: string;
  duplicate_vin: boolean;
  last_metadata_change_at: string;
  verification_reset_count: number;
  had_dispute: boolean;
  last_dispute_resolved_at: string;
  last_dispute_terminal: string;
  dispute_opened_at: string;
  fuel_type: string;
  body_type: string;
  transmission: string;
  condition: string;
  vehicle_type: string;
  colour: string;
  location_label: string;
  location_place_id: string;
  location_country_code: string;
  dispute_deposit: string | null;
  created_at: string;
  updated_at: string;
};

export function mapPassportEntityRow(row: PassportEntityPgRow): PassportEntityRow {
  return {
    id: row.id,
    chainId: row.chain_id,
    owner: row.owner,
    status: row.status,
    verifier: row.verifier,
    verifiedAt: BigInt(row.verified_at),
    tokenUri: row.token_uri,
    coverPhotoUri: row.cover_photo_uri,
    vin: row.vin,
    make: row.make,
    model: row.model,
    year: row.year,
    mileageKm: row.mileage_km,
    lastDisputer: row.last_disputer,
    disputeReason: row.dispute_reason,
    disputeWithdrawnAt: BigInt(row.dispute_withdrawn_at),
    lastVerificationResetAt: BigInt(row.last_verification_reset_at),
    duplicateVin: row.duplicate_vin,
    lastMetadataChangeAt: BigInt(row.last_metadata_change_at),
    verificationResetCount: row.verification_reset_count,
    hadDispute: row.had_dispute,
    lastDisputeResolvedAt: BigInt(row.last_dispute_resolved_at),
    lastDisputeTerminal: row.last_dispute_terminal,
    disputeOpenedAt: BigInt(row.dispute_opened_at),
    fuelType: row.fuel_type,
    bodyType: row.body_type,
    transmission: row.transmission,
    condition: row.condition,
    vehicleType: row.vehicle_type,
    colour: row.colour,
    locationLabel: row.location_label,
    locationPlaceId: row.location_place_id,
    locationCountryCode: row.location_country_code,
    disputeDeposit:
      row.dispute_deposit != null ? BigInt(row.dispute_deposit) : null,
    createdAt: BigInt(row.created_at),
    updatedAt: BigInt(row.updated_at),
  };
}

export function buildPassportEntityUnionSubquery(
  namespaces: readonly number[],
  includeSvm: boolean,
): string {
  return buildPassportEntityUnionSubqueryWithParam(namespaces, includeSvm, "$1");
}

function buildPassportEntityUnionSubqueryWithParam(
  namespaces: readonly number[],
  includeSvm: boolean,
  namespaceParam: string,
): string {
  const evm = `${PASSPORT_ENTITY_EVM_SELECT}
    WHERE "chainId" = ANY(${namespaceParam}::int[])`;
  if (!includeSvm) return `(${evm})`;
  const svm = `${PASSPORT_ENTITY_SVM_SELECT}
    WHERE chain_id = ANY(${namespaceParam}::int[])`;
  return `(${evm} UNION ALL ${svm})`;
}

function buildEntityUnionFromClause(args: {
  namespaces: readonly number[];
  includeSvmProjection: boolean;
  params: unknown[];
}): string {
  args.params.push(args.namespaces);
  const namespaceParam = `$${args.params.length}`;
  return buildPassportEntityUnionSubqueryWithParam(
    args.namespaces,
    args.includeSvmProjection,
    namespaceParam,
  );
}

function buildEntityWhereClauses(
  filters: Partial<PassportEntityBrowseFilters> & {
    ids?: string[];
    verifierExact?: string;
    statusExact?: string;
    chainId?: number;
  },
  params: unknown[],
): string[] {
  const where: string[] = [];

  if (filters.chainId != null) {
    params.push(filters.chainId);
    where.push(`chain_id = $${params.length}`);
  }

  if (filters.ids != null && filters.ids.length > 0) {
    params.push(filters.ids);
    where.push(`id = ANY($${params.length}::text[])`);
  }
  if (filters.owner != null) {
    params.push(filters.owner);
    where.push(`owner = $${params.length}`);
  }
  if (filters.statusExact != null) {
    params.push(filters.statusExact);
    where.push(`status = $${params.length}`);
  } else if (filters.status != null) {
    params.push(filters.status);
    where.push(`status = $${params.length}`);
  }
  if (filters.vin != null) {
    params.push(filters.vin);
    where.push(`vin = $${params.length}`);
  }
  if (filters.verifierExact != null) {
    params.push(filters.verifierExact);
    where.push(`verifier = $${params.length}`);
  } else if (filters.verifier != null) {
    params.push(getAddress(filters.verifier));
    where.push(`verifier = $${params.length}`);
  }

  return where;
}

function buildEntityOrderBy(verifiedFirst?: boolean): string {
  if (verifiedFirst !== false) {
    return `ORDER BY ${PASSPORT_STATUS_ORDER_SQL}, created_at DESC, id DESC`;
  }
  return `ORDER BY created_at DESC, id DESC`;
}

export async function loadPassportEntityById(
  tokenId: string,
  opts?: PassportEntityQueryOptions,
  pool: pg.Pool = getEntityPool(),
): Promise<PassportEntityRow | null> {
  const namespaces = resolveEntityNamespaces(opts);
  const params: unknown[] = [];
  const fromSql = buildEntityUnionFromClause({
    namespaces,
    includeSvmProjection: opts?.includeSvmProjection ?? true,
    params,
  });
  params.push(tokenId);
  const tokenParam = `$${params.length}`;
  const sql = `SELECT * FROM ${fromSql} AS passport_union
    WHERE id = ${tokenParam}
    LIMIT 1`;
  const res = await pool.query<PassportEntityPgRow>(sql, params);
  const row = res.rows[0];
  return row ? mapPassportEntityRow(row) : null;
}

export async function loadPassportEntitiesBrowse(
  filters: PassportEntityBrowseFilters,
  opts?: PassportEntityQueryOptions,
  pool: pg.Pool = getEntityPool(),
): Promise<{ rows: PassportEntityRow[]; total: number }> {
  const namespaces = resolveEntityNamespaces(opts);
  const params: unknown[] = [];
  const fromSql = buildEntityUnionFromClause({
    namespaces,
    includeSvmProjection: opts?.includeSvmProjection ?? true,
    params,
  });
  const where = buildEntityWhereClauses(filters, params);
  const whereClause =
    where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const orderBy = buildEntityOrderBy(filters.verifiedFirst);

  params.push(filters.limit);
  const limitParam = `$${params.length}`;
  params.push(filters.offset);
  const offsetParam = `$${params.length}`;

  const baseSql = `SELECT * FROM ${fromSql} AS passport_union ${whereClause}`;
  const [rowsRes, totalRes] = await Promise.all([
    pool.query<PassportEntityPgRow>(
      `${baseSql} ${orderBy} LIMIT ${limitParam} OFFSET ${offsetParam}`,
      params,
    ),
    pool.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM (${baseSql}) AS counted`,
      params.slice(0, params.length - 2),
    ),
  ]);

  return {
    rows: rowsRes.rows.map(mapPassportEntityRow),
    total: totalRes.rows[0]?.total ?? 0,
  };
}

export async function loadPassportEntitiesFiltered(
  filters: Partial<PassportEntityBrowseFilters> & {
    ids?: string[];
    verifierExact?: string;
    statusExact?: string;
    chainId?: number;
  },
  opts?: PassportEntityQueryOptions,
  pool: pg.Pool = getEntityPool(),
): Promise<PassportEntityRow[]> {
  const namespaces = resolveEntityNamespaces(opts);
  const params: unknown[] = [];
  const fromSql = buildEntityUnionFromClause({
    namespaces,
    includeSvmProjection: opts?.includeSvmProjection ?? true,
    params,
  });
  const where = buildEntityWhereClauses(filters, params);
  const whereClause =
    where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const sql = `SELECT * FROM ${fromSql} AS passport_union ${whereClause}
    ORDER BY created_at DESC, id DESC`;
  const res = await pool.query<PassportEntityPgRow>(sql, params);
  return res.rows.map(mapPassportEntityRow);
}

export async function loadPassportEntitiesByIds(
  ids: readonly string[],
  opts?: PassportEntityQueryOptions,
  pool: pg.Pool = getEntityPool(),
): Promise<PassportEntityRow[]> {
  if (ids.length === 0) return [];
  const namespaces = resolveEntityNamespaces(opts);
  const params: unknown[] = [];
  const fromSql = buildEntityUnionFromClause({
    namespaces,
    includeSvmProjection: opts?.includeSvmProjection ?? true,
    params,
  });
  const where = buildEntityWhereClauses({ ids: [...ids] }, params);
  const sql = `SELECT * FROM ${fromSql} AS passport_union
    WHERE ${where.join(" AND ")}`;
  const res = await pool.query<PassportEntityPgRow>(sql, params);
  return res.rows.map(mapPassportEntityRow);
}

export async function loadPassportEntitiesByOwner(
  owner: string,
  opts?: PassportEntityQueryOptions,
  pool: pg.Pool = getEntityPool(),
): Promise<PassportEntityRow[]> {
  const namespaces = resolveEntityNamespaces(opts);
  const params: unknown[] = [];
  const fromSql = buildEntityUnionFromClause({
    namespaces,
    includeSvmProjection: opts?.includeSvmProjection ?? true,
    params,
  });
  const where = buildEntityWhereClauses({ owner }, params);
  const sql = `SELECT * FROM ${fromSql} AS passport_union
    WHERE ${where.join(" AND ")}
    ORDER BY created_at DESC, id DESC`;
  const res = await pool.query<PassportEntityPgRow>(sql, params);
  return res.rows.map(mapPassportEntityRow);
}

export async function countVerifiedPassportsByVerifier(
  opts?: PassportEntityQueryOptions,
  pool: pg.Pool = getEntityPool(),
): Promise<VerifierVerificationCountRow[]> {
  const namespaces = resolveEntityNamespaces(opts);
  const params: unknown[] = [];
  const fromSql = buildEntityUnionFromClause({
    namespaces,
    includeSvmProjection: opts?.includeSvmProjection ?? true,
    params,
  });
  params.push("VERIFIED");
  const statusParam = `$${params.length}`;
  const sql = `SELECT verifier, COUNT(*)::int AS total
    FROM ${fromSql} AS passport_union
    WHERE status = ${statusParam} AND verifier <> ''
    GROUP BY verifier`;
  const res = await pool.query<{ verifier: string; total: number }>(sql, params);
  return res.rows.map((row) => ({
    verifier: row.verifier,
    total: row.total,
  }));
}

export async function loadVerifiedPassportsByVerifier(
  verifier: string,
  pagination: { limit: number; offset: number },
  opts?: PassportEntityQueryOptions,
  pool: pg.Pool = getEntityPool(),
): Promise<PassportEntityRow[]> {
  const namespaces = resolveEntityNamespaces(opts);
  const params: unknown[] = [];
  const fromSql = buildEntityUnionFromClause({
    namespaces,
    includeSvmProjection: opts?.includeSvmProjection ?? true,
    params,
  });
  const where = buildEntityWhereClauses(
    {
      verifierExact: getAddress(verifier),
      statusExact: "VERIFIED",
    },
    params,
  );
  params.push(pagination.limit);
  const limitParam = `$${params.length}`;
  params.push(pagination.offset);
  const offsetParam = `$${params.length}`;
  const sql = `SELECT * FROM ${fromSql} AS passport_union
    WHERE ${where.join(" AND ")}
    ORDER BY verified_at DESC, id DESC
    LIMIT ${limitParam} OFFSET ${offsetParam}`;
  const res = await pool.query<PassportEntityPgRow>(sql, params);
  return res.rows.map(mapPassportEntityRow);
}

export type PassportEntityStatusCounts = {
  UNVERIFIED: number;
  VERIFIED: number;
  DISPUTED: number;
};

function emptyEntityStatusCounts(): PassportEntityStatusCounts {
  return { UNVERIFIED: 0, VERIFIED: 0, DISPUTED: 0 };
}

function foldEntityStatusCounts(
  rows: Array<{ status: string | null; total: number }>,
): PassportEntityStatusCounts {
  const counts = emptyEntityStatusCounts();
  for (const row of rows) {
    const status = row.status ?? "UNVERIFIED";
    if (status in counts) {
      counts[status as keyof PassportEntityStatusCounts] += Number(row.total);
    }
  }
  return counts;
}

export async function loadPassportEntityStatusCounts(
  opts?: PassportEntityQueryOptions,
  pool: pg.Pool = getEntityPool(),
): Promise<PassportEntityStatusCounts> {
  const namespaces = resolveEntityNamespaces(opts);
  const params: unknown[] = [];
  const fromSql = buildEntityUnionFromClause({
    namespaces,
    includeSvmProjection: opts?.includeSvmProjection ?? true,
    params,
  });
  const sql = `SELECT status, COUNT(*)::int AS total
    FROM ${fromSql} AS passport_union
    GROUP BY status`;
  const res = await pool.query<{ status: string | null; total: number }>(sql, params);
  return foldEntityStatusCounts(res.rows);
}
