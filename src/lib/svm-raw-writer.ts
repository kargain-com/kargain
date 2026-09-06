/**
 * Sole INSERT owner for kargain_svm_raw (S7c-1).
 */

import type pg from "pg";

import type {
  BootstrapCatchupState,
  CatchupIncident,
} from "../../lib/svm/ingest-refusal.js";
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
    bootstrapState: BootstrapCatchupState | null;
    catchupIncident: CatchupIncident | null;
  } | null>;
  upsertCursor: (args: {
    namespace: number;
    lastContiguousSlot: number;
    bootstrapState: BootstrapCatchupState | null;
    catchupIncident: CatchupIncident | null;
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
        bootstrap_state: BootstrapCatchupState | null;
        catchup_incident: CatchupIncident | null;
      }>(
        `SELECT last_contiguous_slot, bootstrap_state, catchup_incident
         FROM kargain_svm_raw.ingest_cursor
         WHERE id = $1 AND namespace = $2`,
        ["default", namespace],
      );
      const row = res.rows[0];
      if (!row) return null;
      return {
        lastContiguousSlot: Number(row.last_contiguous_slot),
        bootstrapState: row.bootstrap_state,
        catchupIncident: row.catchup_incident,
      };
    },

    async upsertCursor(args) {
      await pool.query(
        `INSERT INTO kargain_svm_raw.ingest_cursor (
          id, namespace, last_contiguous_slot, bootstrap_state, catchup_incident, updated_at
        ) VALUES ($1,$2,$3,$4,$5,now())
        ON CONFLICT (id) DO UPDATE SET
          last_contiguous_slot = EXCLUDED.last_contiguous_slot,
          bootstrap_state = EXCLUDED.bootstrap_state,
          catchup_incident = EXCLUDED.catchup_incident,
          updated_at = now()`,
        [
          "default",
          args.namespace,
          args.lastContiguousSlot,
          args.bootstrapState,
          args.catchupIncident,
        ],
      );
    },
  };
}

export class SvmRawSchemaFormError extends Error {
  readonly missing: readonly string[];

  constructor(missing: readonly string[]) {
    const list = missing.join(", ");
    super(
      `kargain_svm_raw.metadata_snapshot schema form is stale or incomplete (missing: ${list}). ` +
        `CREATE TABLE IF NOT EXISTS does not reshape an older table. ` +
        `Drop kargain_svm_raw.metadata_snapshot (or schema kargain_svm_raw) on databases created before the raw-sentinel form, then restart svm-ingest.`,
    );
    this.name = "SvmRawSchemaFormError";
    this.missing = missing;
  }
}

const METADATA_SNAPSHOT_DIGEST_STATUS_CK = "metadata_snapshot_digest_status_ck";
const METADATA_SNAPSHOT_CAPTURED_URI_DIGEST_UIDX =
  "metadata_snapshot_captured_uri_digest_uidx";
const INGEST_CURSOR_BOOTSTRAP_STATE_COLUMN = "bootstrap_state";

/**
 * Fail-closed: after DDL apply, the live catalog must carry the raw-sentinel
 * form markers. IF NOT EXISTS cannot upgrade a pre-sentinel table.
 */
export async function assertSvmRawMetadataSnapshotForm(
  pool: pg.Pool,
): Promise<void> {
  const missing: string[] = [];

  const ck = await pool.query<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM pg_constraint c
       JOIN pg_class t ON c.conrelid = t.oid
       JOIN pg_namespace n ON t.relnamespace = n.oid
       WHERE n.nspname = 'kargain_svm_raw'
         AND t.relname = 'metadata_snapshot'
         AND c.conname = $1
         AND c.contype = 'c'
     ) AS ok`,
    [METADATA_SNAPSHOT_DIGEST_STATUS_CK],
  );
  if (!ck.rows[0]?.ok) missing.push(METADATA_SNAPSHOT_DIGEST_STATUS_CK);

  const uidx = await pool.query<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM pg_class i
       JOIN pg_namespace n ON i.relnamespace = n.oid
       JOIN pg_index idx ON i.oid = idx.indexrelid
       JOIN pg_class t ON idx.indrelid = t.oid
       JOIN pg_namespace tn ON t.relnamespace = tn.oid
       WHERE n.nspname = 'kargain_svm_raw'
         AND tn.nspname = 'kargain_svm_raw'
         AND i.relname = $1
         AND t.relname = 'metadata_snapshot'
         AND idx.indisunique
     ) AS ok`,
    [METADATA_SNAPSHOT_CAPTURED_URI_DIGEST_UIDX],
  );
  if (!uidx.rows[0]?.ok) {
    missing.push(METADATA_SNAPSHOT_CAPTURED_URI_DIGEST_UIDX);
  }

  const bootstrapState = await pool.query<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'kargain_svm_raw'
         AND table_name = 'ingest_cursor'
         AND column_name = $1
     ) AS ok`,
    [INGEST_CURSOR_BOOTSTRAP_STATE_COLUMN],
  );
  if (!bootstrapState.rows[0]?.ok) {
    missing.push(`ingest_cursor.${INGEST_CURSOR_BOOTSTRAP_STATE_COLUMN}`);
  }

  if (missing.length > 0) {
    throw new SvmRawSchemaFormError(missing);
  }
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
  await assertSvmRawMetadataSnapshotForm(pool);
}
