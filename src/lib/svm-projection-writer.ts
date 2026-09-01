/**
 * Sole INSERT owner for kargain_svm_projection (S7c-2).
 */

import type pg from "pg";

import type {
  CustodyDeterminingProjectionDraft,
  PassportEntityProjectionDraft,
  PassportRecordProjectionDraft,
  PassportUriHistoryProjectionDraft,
} from "../../lib/svm/project-raw-to-projection.js";

export type SvmProjectionWriter = {
  insertPassportRecord: (row: PassportRecordProjectionDraft) => Promise<boolean>;
  insertPassportUriHistory: (
    row: PassportUriHistoryProjectionDraft,
  ) => Promise<boolean>;
  insertCustodyDeterminingEvent: (
    row: CustodyDeterminingProjectionDraft,
  ) => Promise<boolean>;
  upsertPassportEntity: (row: PassportEntityProjectionDraft) => Promise<boolean>;
  insertPassportRecords: (rows: PassportRecordProjectionDraft[]) => Promise<number>;
  insertPassportUriHistoryRows: (
    rows: PassportUriHistoryProjectionDraft[],
  ) => Promise<number>;
  insertCustodyDeterminingEvents: (
    rows: CustodyDeterminingProjectionDraft[],
  ) => Promise<number>;
  upsertPassportEntities: (rows: PassportEntityProjectionDraft[]) => Promise<number>;
};

export function createSvmProjectionWriter(pool: pg.Pool): SvmProjectionWriter {
  return {
    async insertPassportRecord(row) {
      const res = await pool.query(
        `INSERT INTO kargain_svm_projection.passport_record (
          id, token_id, chain_id, author, record_type, description, evidence_cid, timestamp
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (id) DO NOTHING`,
        [
          row.id,
          row.tokenId,
          row.chainId,
          row.author,
          row.recordType,
          row.description,
          row.evidenceCID,
          row.timestamp.toString(),
        ],
      );
      return (res.rowCount ?? 0) > 0;
    },

    async insertPassportUriHistory(row) {
      const res = await pool.query(
        `INSERT INTO kargain_svm_projection.passport_uri_history (
          id, token_id, chain_id, previous_uri, new_uri, author, verification_reset, timestamp
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (id) DO NOTHING`,
        [
          row.id,
          row.tokenId,
          row.chainId,
          row.previousUri,
          row.newUri,
          row.author,
          row.verificationReset,
          row.timestamp.toString(),
        ],
      );
      return (res.rowCount ?? 0) > 0;
    },

    async insertCustodyDeterminingEvent(row) {
      const res = await pool.query(
        `INSERT INTO kargain_svm_projection.custody_determining_event (
          id, token_id, chain_id, kind, block_number, log_index
        ) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (id) DO NOTHING`,
        [
          row.id,
          row.tokenId,
          row.chainId,
          row.kind,
          row.blockNumber,
          row.logIndex,
        ],
      );
      return (res.rowCount ?? 0) > 0;
    },

    async upsertPassportEntity(row) {
      const res = await pool.query(
        `INSERT INTO kargain_svm_projection.passport (
          id, chain_id, owner, status, verifier, verified_at, token_uri, cover_photo_uri,
          vin, make, model, year, mileage_km, last_disputer, dispute_reason,
          dispute_withdrawn_at, last_verification_reset_at, duplicate_vin,
          last_metadata_change_at, verification_reset_count, had_dispute,
          last_dispute_resolved_at, last_dispute_terminal, dispute_opened_at,
          fuel_type, body_type, transmission, condition, vehicle_type, colour,
          location_label, location_place_id, location_country_code, dispute_deposit,
          created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,
          $25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36
        )
        ON CONFLICT (id) DO UPDATE SET
          chain_id = EXCLUDED.chain_id,
          owner = EXCLUDED.owner,
          status = EXCLUDED.status,
          verifier = EXCLUDED.verifier,
          verified_at = EXCLUDED.verified_at,
          token_uri = EXCLUDED.token_uri,
          cover_photo_uri = EXCLUDED.cover_photo_uri,
          vin = EXCLUDED.vin,
          make = EXCLUDED.make,
          model = EXCLUDED.model,
          year = EXCLUDED.year,
          mileage_km = EXCLUDED.mileage_km,
          last_disputer = EXCLUDED.last_disputer,
          dispute_reason = EXCLUDED.dispute_reason,
          dispute_withdrawn_at = EXCLUDED.dispute_withdrawn_at,
          last_verification_reset_at = EXCLUDED.last_verification_reset_at,
          duplicate_vin = EXCLUDED.duplicate_vin,
          last_metadata_change_at = EXCLUDED.last_metadata_change_at,
          verification_reset_count = EXCLUDED.verification_reset_count,
          had_dispute = EXCLUDED.had_dispute,
          last_dispute_resolved_at = EXCLUDED.last_dispute_resolved_at,
          last_dispute_terminal = EXCLUDED.last_dispute_terminal,
          dispute_opened_at = EXCLUDED.dispute_opened_at,
          fuel_type = EXCLUDED.fuel_type,
          body_type = EXCLUDED.body_type,
          transmission = EXCLUDED.transmission,
          condition = EXCLUDED.condition,
          vehicle_type = EXCLUDED.vehicle_type,
          colour = EXCLUDED.colour,
          location_label = EXCLUDED.location_label,
          location_place_id = EXCLUDED.location_place_id,
          location_country_code = EXCLUDED.location_country_code,
          dispute_deposit = EXCLUDED.dispute_deposit,
          created_at = EXCLUDED.created_at,
          updated_at = EXCLUDED.updated_at`,
        [
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
        ],
      );
      return (res.rowCount ?? 0) > 0;
    },

    async insertPassportRecords(rows) {
      let inserted = 0;
      for (const row of rows) {
        if (await this.insertPassportRecord(row)) inserted += 1;
      }
      return inserted;
    },

    async insertPassportUriHistoryRows(rows) {
      let inserted = 0;
      for (const row of rows) {
        if (await this.insertPassportUriHistory(row)) inserted += 1;
      }
      return inserted;
    },
    async insertCustodyDeterminingEvents(rows) {
      let inserted = 0;
      for (const row of rows) {
        if (await this.insertCustodyDeterminingEvent(row)) inserted += 1;
      }
      return inserted;
    },
    async upsertPassportEntities(rows) {
      let upserted = 0;
      for (const row of rows) {
        if (await this.upsertPassportEntity(row)) upserted += 1;
      }
      return upserted;
    },
  };
}

export async function applySvmProjectionSchema(pool: pg.Pool): Promise<void> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const schemaPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../svm-ingest/db/projection-schema.sql",
  );
  const sql = await fs.readFile(schemaPath, "utf8");
  await pool.query(sql);
}

export async function dropSvmProjectionSchema(pool: pg.Pool): Promise<void> {
  await pool.query("DROP SCHEMA IF EXISTS kargain_svm_projection CASCADE");
}
