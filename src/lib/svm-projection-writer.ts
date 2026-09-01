/**
 * Sole INSERT owner for kargain_svm_projection (S7c-2).
 */

import type pg from "pg";

import type {
  PassportRecordProjectionDraft,
  PassportUriHistoryProjectionDraft,
} from "../../lib/svm/project-raw-to-projection.js";

export type SvmProjectionWriter = {
  insertPassportRecord: (row: PassportRecordProjectionDraft) => Promise<boolean>;
  insertPassportUriHistory: (
    row: PassportUriHistoryProjectionDraft,
  ) => Promise<boolean>;
  insertPassportRecords: (rows: PassportRecordProjectionDraft[]) => Promise<number>;
  insertPassportUriHistoryRows: (
    rows: PassportUriHistoryProjectionDraft[],
  ) => Promise<number>;
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
