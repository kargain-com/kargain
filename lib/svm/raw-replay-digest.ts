/**
 * Chain-free canonical digest of kargain_svm_raw.structured_payload (S7c-1 rebuild proof).
 */

import { createHash } from "node:crypto";
import type pg from "pg";

export type StructuredPayloadRow = {
  id: string;
  namespace: number;
  slot: number;
  tx_index_in_block: number;
  log_index: number;
  tx_signature: string;
  emitting_program: string;
  discriminator: Buffer;
  event_name: string;
  contract_name: string;
  payload_bytes: Buffer;
};

export function canonicalPayloadLine(row: StructuredPayloadRow): string {
  return JSON.stringify({
    id: row.id,
    namespace: row.namespace,
    slot: row.slot,
    tx_index_in_block: row.tx_index_in_block,
    log_index: row.log_index,
    tx_signature: row.tx_signature,
    emitting_program: row.emitting_program,
    discriminator: row.discriminator.toString("hex"),
    event_name: row.event_name,
    contract_name: row.contract_name,
    payload_bytes: row.payload_bytes.toString("base64"),
  });
}

export async function fetchStructuredPayloadsOrdered(
  pool: pg.Pool,
  namespace?: number,
): Promise<StructuredPayloadRow[]> {
  const res = namespace
    ? await pool.query<StructuredPayloadRow>(
        `SELECT id, namespace, slot, tx_index_in_block, log_index, tx_signature,
                emitting_program, discriminator, event_name, contract_name, payload_bytes
         FROM kargain_svm_raw.structured_payload
         WHERE namespace = $1
         ORDER BY slot, tx_index_in_block, log_index`,
        [namespace],
      )
    : await pool.query<StructuredPayloadRow>(
        `SELECT id, namespace, slot, tx_index_in_block, log_index, tx_signature,
                emitting_program, discriminator, event_name, contract_name, payload_bytes
         FROM kargain_svm_raw.structured_payload
         ORDER BY namespace, slot, tx_index_in_block, log_index`,
      );
  return res.rows;
}

export function digestStructuredPayloadRows(rows: readonly StructuredPayloadRow[]): string {
  const hash = createHash("sha256");
  for (const row of rows) {
    hash.update(canonicalPayloadLine(row));
    hash.update("\n");
  }
  return hash.digest("hex");
}

export async function replayDigestFromPool(
  pool: pg.Pool,
  namespace?: number,
): Promise<{ digest: string; rowCount: number }> {
  const rows = await fetchStructuredPayloadsOrdered(pool, namespace);
  return { digest: digestStructuredPayloadRows(rows), rowCount: rows.length };
}
