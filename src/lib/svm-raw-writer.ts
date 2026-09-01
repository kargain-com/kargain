/**
 * Sole INSERT owner for kargain_svm_raw (S7c-1).
 */

import type pg from "pg";

import type { MetadataSnapshotDraft } from "../../lib/svm/metadata-snapshot.js";
import type {
  IngestRefusalDraft,
  StructuredPayloadDraft,
} from "../../lib/svm/parse-transaction-ingest.js";

export type SvmRawWriter = {
  insertStructuredPayload: (row: StructuredPayloadDraft) => Promise<boolean>;
  insertMetadataSnapshot: (row: MetadataSnapshotDraft) => Promise<boolean>;
  insertIngestRefusal: (row: IngestRefusalDraft) => Promise<boolean>;
  insertStructuredPayloads: (rows: StructuredPayloadDraft[]) => Promise<number>;
  insertMetadataSnapshots: (rows: MetadataSnapshotDraft[]) => Promise<number>;
  insertIngestRefusals: (rows: IngestRefusalDraft[]) => Promise<number>;
  getCursor: (namespace: number) => Promise<{
    lastContiguousSlot: number;
    catchupIncident: string | null;
  } | null>;
  upsertCursor: (args: {
    namespace: number;
    lastContiguousSlot: number;
    catchupIncident: string | null;
  }) => Promise<void>;
};

export function createSvmRawWriter(pool: pg.Pool): SvmRawWriter {
  return {
    async insertStructuredPayload(row) {
      const res = await pool.query(
        `INSERT INTO kargain_svm_raw.structured_payload (
          id, namespace, slot, tx_index_in_block, log_index, tx_signature,
          emitting_program, discriminator, event_name, contract_name, payload_bytes
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT (id) DO NOTHING`,
        [
          row.id,
          row.namespace,
          row.slot,
          row.txIndexInBlock,
          row.logIndex,
          row.txSignature,
          row.emittingProgram,
          row.discriminator,
          row.eventName,
          row.contractName,
          row.payloadBytes,
        ],
      );
      return (res.rowCount ?? 0) > 0;
    },

    async insertMetadataSnapshot(row) {
      const res = await pool.query(
        `INSERT INTO kargain_svm_raw.metadata_snapshot (
          id, namespace, uri, content_sha256, parsed_json, source_payload_id, slot, status
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (id) DO NOTHING`,
        [
          row.id,
          row.namespace,
          row.uri,
          row.contentSha256,
          row.parsedJson != null ? JSON.stringify(row.parsedJson) : null,
          row.sourcePayloadId,
          row.slot,
          row.status,
        ],
      );
      return (res.rowCount ?? 0) > 0;
    },

    async insertIngestRefusal(row) {
      const res = await pool.query(
        `INSERT INTO kargain_svm_raw.ingest_refusal (
          id, namespace, refusal_kind, slot, tx_index_in_block, log_index,
          tx_signature, emitting_program, discriminator, detail
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (id) DO NOTHING`,
        [
          row.id,
          row.namespace,
          row.refusalKind,
          row.slot,
          row.txIndexInBlock,
          row.logIndex,
          row.txSignature,
          row.emittingProgram,
          row.discriminator,
          JSON.stringify(row.detail),
        ],
      );
      return (res.rowCount ?? 0) > 0;
    },

    async insertStructuredPayloads(rows) {
      let inserted = 0;
      for (const row of rows) {
        if (await this.insertStructuredPayload(row)) inserted += 1;
      }
      return inserted;
    },

    async insertMetadataSnapshots(rows) {
      let inserted = 0;
      for (const row of rows) {
        if (await this.insertMetadataSnapshot(row)) inserted += 1;
      }
      return inserted;
    },

    async insertIngestRefusals(rows) {
      let inserted = 0;
      for (const row of rows) {
        if (await this.insertIngestRefusal(row)) inserted += 1;
      }
      return inserted;
    },

    async getCursor(namespace) {
      const res = await pool.query<{
        last_contiguous_slot: string;
        catchup_incident: string | null;
      }>(
        `SELECT last_contiguous_slot, catchup_incident
         FROM kargain_svm_raw.ingest_cursor
         WHERE id = $1 AND namespace = $2`,
        ["default", namespace],
      );
      const row = res.rows[0];
      if (!row) return null;
      return {
        lastContiguousSlot: Number(row.last_contiguous_slot),
        catchupIncident: row.catchup_incident,
      };
    },

    async upsertCursor(args) {
      await pool.query(
        `INSERT INTO kargain_svm_raw.ingest_cursor (
          id, namespace, last_contiguous_slot, catchup_incident, updated_at
        ) VALUES ($1,$2,$3,$4,now())
        ON CONFLICT (id) DO UPDATE SET
          last_contiguous_slot = EXCLUDED.last_contiguous_slot,
          catchup_incident = EXCLUDED.catchup_incident,
          updated_at = now()`,
        [
          "default",
          args.namespace,
          args.lastContiguousSlot,
          args.catchupIncident,
        ],
      );
    },
  };
}

export async function applySvmRawSchema(pool: pg.Pool): Promise<void> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const schemaPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../svm-ingest/db/schema.sql",
  );
  const sql = await fs.readFile(schemaPath, "utf8");
  await pool.query(sql);
}
