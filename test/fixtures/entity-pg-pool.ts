/**
 * pg-mem Postgres pool for passport entity UNION SQL tests (S7c-4).
 * Executes the same SQL strings as production — not a regex stub.
 * EVM columns match Ponder 0.16 snake_case physical names.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { newDb, type IMemoryDb, DataType } from "pg-mem";
import type pg from "pg";

import type { PassportEntityRow } from "../../src/lib/ponder-passport-entity.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const EVM_PASSPORT_DDL = `
CREATE SCHEMA IF NOT EXISTS kargain;
CREATE TABLE IF NOT EXISTS kargain.passport (
  id TEXT PRIMARY KEY,
  chain_id INTEGER NOT NULL,
  owner TEXT NOT NULL,
  status TEXT NOT NULL,
  verifier TEXT NOT NULL DEFAULT '',
  verified_at BIGINT NOT NULL DEFAULT 0,
  token_uri TEXT NOT NULL DEFAULT '',
  cover_photo_uri TEXT NOT NULL DEFAULT '',
  vin TEXT NOT NULL DEFAULT '',
  make TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  year INTEGER NOT NULL DEFAULT 0,
  mileage_km INTEGER NOT NULL DEFAULT 0,
  last_disputer TEXT NOT NULL DEFAULT '',
  dispute_reason TEXT NOT NULL DEFAULT '',
  dispute_withdrawn_at BIGINT NOT NULL DEFAULT 0,
  last_verification_reset_at BIGINT NOT NULL DEFAULT 0,
  duplicate_vin BOOLEAN NOT NULL DEFAULT false,
  last_metadata_change_at BIGINT NOT NULL DEFAULT 0,
  verification_reset_count INTEGER NOT NULL DEFAULT 0,
  had_dispute BOOLEAN NOT NULL DEFAULT false,
  last_dispute_resolved_at BIGINT NOT NULL DEFAULT 0,
  last_dispute_terminal TEXT NOT NULL DEFAULT '',
  dispute_opened_at BIGINT NOT NULL DEFAULT 0,
  fuel_type TEXT NOT NULL DEFAULT '',
  body_type TEXT NOT NULL DEFAULT '',
  transmission TEXT NOT NULL DEFAULT '',
  condition TEXT NOT NULL DEFAULT '',
  vehicle_type TEXT NOT NULL DEFAULT '',
  colour TEXT NOT NULL DEFAULT '',
  location_label TEXT NOT NULL DEFAULT '',
  location_place_id TEXT NOT NULL DEFAULT '',
  location_country_code TEXT NOT NULL DEFAULT '',
  dispute_deposit BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
`;

function svmProjectionPassportDdl(): string {
  const sql = fs.readFileSync(
    path.join(ROOT, "src/svm-ingest/db/projection-schema.sql"),
    "utf8",
  );
  const match = sql.match(
    /CREATE SCHEMA IF NOT EXISTS kargain_svm_projection;[\s\S]*?CREATE TABLE IF NOT EXISTS kargain_svm_projection\.passport \([\s\S]*?\);/,
  );
  if (!match) {
    throw new Error("projection-schema.sql: passport table DDL not found");
  }
  return match[0];
}

function registerPgMemFunctions(db: IMemoryDb): void {
  db.public.registerFunction({
    name: "lower",
    args: [DataType.text],
    returns: DataType.text,
    implementation: (value: string | null) =>
      value == null ? null : value.toLowerCase(),
  });
}

function evmInsertParams(row: PassportEntityRow): unknown[] {
  return [
    row.id,
    row.chainId,
    row.owner,
    row.status,
    row.verifier,
    row.verifiedAt.toString(),
    row.tokenUri,
    row.coverPhotoUri,
    row.vin,
    row.make,
    row.model,
    row.year,
    row.mileageKm,
    row.lastDisputer,
    row.disputeReason,
    row.disputeWithdrawnAt.toString(),
    row.lastVerificationResetAt.toString(),
    row.duplicateVin,
    row.lastMetadataChangeAt.toString(),
    row.verificationResetCount,
    row.hadDispute,
    row.lastDisputeResolvedAt.toString(),
    row.lastDisputeTerminal,
    row.disputeOpenedAt.toString(),
    row.fuelType,
    row.bodyType,
    row.transmission,
    row.condition,
    row.vehicleType,
    row.colour,
    row.locationLabel,
    row.locationPlaceId,
    row.locationCountryCode,
    row.disputeDeposit?.toString() ?? null,
    row.createdAt.toString(),
    row.updatedAt.toString(),
  ];
}

function svmInsertParams(row: PassportEntityRow): unknown[] {
  return evmInsertParams(row);
}

const EVM_INSERT = `INSERT INTO kargain.passport (
  id, chain_id, owner, status, verifier, verified_at, token_uri, cover_photo_uri,
  vin, make, model, year, mileage_km, last_disputer, dispute_reason,
  dispute_withdrawn_at, last_verification_reset_at, duplicate_vin, last_metadata_change_at,
  verification_reset_count, had_dispute, last_dispute_resolved_at, last_dispute_terminal,
  dispute_opened_at, fuel_type, body_type, transmission, condition, vehicle_type, colour,
  location_label, location_place_id, location_country_code, dispute_deposit, created_at, updated_at
) VALUES (
  $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36
)`;

const SVM_INSERT = `INSERT INTO kargain_svm_projection.passport (
  id, chain_id, owner, status, verifier, verified_at, token_uri, cover_photo_uri,
  vin, make, model, year, mileage_km, last_disputer, dispute_reason,
  dispute_withdrawn_at, last_verification_reset_at, duplicate_vin, last_metadata_change_at,
  verification_reset_count, had_dispute, last_dispute_resolved_at, last_dispute_terminal,
  dispute_opened_at, fuel_type, body_type, transmission, condition, vehicle_type, colour,
  location_label, location_place_id, location_country_code, dispute_deposit, created_at, updated_at
) VALUES (
  $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36
)`;

export type EntityPgPoolFixture = {
  pool: pg.Pool;
  db: IMemoryDb;
};

export async function createEntityPgPoolForTests(state: {
  evmPassports: PassportEntityRow[];
  svmPassports: PassportEntityRow[];
}): Promise<EntityPgPoolFixture> {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  registerPgMemFunctions(db);
  db.public.none(EVM_PASSPORT_DDL);
  db.public.none(svmProjectionPassportDdl());

  const adapter = db.adapters.createPg();
  const pool = new adapter.Pool() as unknown as pg.Pool;

  for (const row of state.evmPassports) {
    await pool.query(EVM_INSERT, evmInsertParams(row));
  }
  for (const row of state.svmPassports) {
    await pool.query(SVM_INSERT, svmInsertParams(row));
  }

  return { pool, db };
}
