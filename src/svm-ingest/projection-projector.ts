/**
 * Project newly ingested raw payloads into kargain_svm_projection (inline + rebuild).
 */

import type pg from "pg";

import {
  projectStructuredPayload,
  type ProjectionReplayState,
  emptyProjectionReplayState,
} from "../../lib/svm/project-raw-to-projection.js";
import type { StructuredPayloadDraft } from "../../lib/svm/parse-transaction-ingest.js";
import type { SvmProjectionWriter } from "../lib/svm-projection-writer.js";

export async function projectPayloadsIntoWriter(
  writer: SvmProjectionWriter,
  payloads: readonly StructuredPayloadDraft[],
  state?: ProjectionReplayState,
): Promise<ProjectionReplayState> {
  const replay = state ?? emptyProjectionReplayState();
  for (const raw of payloads) {
    const batch = projectStructuredPayload(raw, replay);
    if (!batch) continue;
    await writer.insertPassportRecords(batch.passportRecords);
    await writer.insertPassportUriHistoryRows(batch.uriHistory);
  }
  return replay;
}

export type ProjectionProjector = {
  projectPayloads: (payloads: readonly StructuredPayloadDraft[]) => Promise<void>;
};

export function createProjectionProjector(
  pool: pg.Pool,
  writer: SvmProjectionWriter,
): ProjectionProjector {
  let state = emptyProjectionReplayState();
  return {
    async projectPayloads(payloads) {
      state = await projectPayloadsIntoWriter(writer, payloads, state);
    },
  };
}
