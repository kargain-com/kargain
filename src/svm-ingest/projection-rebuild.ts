/**
 * Drop + replay kargain_svm_projection from kargain_svm_raw (no RPC).
 */

import type pg from "pg";

import { projectStructuredPayloadsOrdered } from "../../lib/svm/project-raw-to-projection.js";
import { fetchStructuredPayloadsOrdered } from "../../lib/svm/raw-replay-digest.js";
import {
  applySvmProjectionSchema,
  createSvmProjectionWriter,
  dropSvmProjectionSchema,
} from "../lib/svm-projection-writer.js";

export async function rebuildProjectionFromRaw(
  pool: pg.Pool,
  namespace?: number,
): Promise<{ recordCount: number; uriCount: number }> {
  await dropSvmProjectionSchema(pool);
  await applySvmProjectionSchema(pool);

  const rawRows = await fetchStructuredPayloadsOrdered(pool, namespace);
  const batch = projectStructuredPayloadsOrdered(
    rawRows.map((row) => ({
      id: row.id,
      namespace: row.namespace,
      slot: row.slot,
      txIndexInBlock: row.tx_index_in_block,
      logIndex: row.log_index,
      contractName: row.contract_name,
      eventName: row.event_name,
      payloadBytes: row.payload_bytes,
    })),
  );

  const writer = createSvmProjectionWriter(pool);
  await writer.insertPassportRecords(batch.passportRecords);
  await writer.insertPassportUriHistoryRows(batch.uriHistory);
  await writer.insertCustodyDeterminingEvents(batch.custodyEvents);

  return {
    recordCount: batch.passportRecords.length,
    uriCount: batch.uriHistory.length,
    custodyCount: batch.custodyEvents.length,
  };
}
