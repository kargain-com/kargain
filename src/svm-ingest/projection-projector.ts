/**
 * Project newly ingested raw payloads into kargain_svm_projection (inline + rebuild).
 */

import type pg from "pg";

import {
  emptyEntityProjectionReplayState,
  finalizeEntityProjectionState,
  loadMetadataSnapshotsIntoState,
} from "../../lib/svm/passport-entity-projection.js";
import type { MetadataSnapshotDraft } from "../../lib/svm/metadata-snapshot.js";
import type { StructuredPayloadDraft } from "../../lib/svm/parse-transaction-ingest.js";
import {
  projectStructuredPayload,
  type ProjectionReplayState,
  emptyProjectionReplayState,
} from "../../lib/svm/project-raw-to-projection.js";
import type { SvmProjectionWriter } from "../lib/svm-projection-writer.js";

export type InlineProjectionState = {
  replay: ProjectionReplayState;
  entity: ReturnType<typeof emptyEntityProjectionReplayState>;
};

export function emptyInlineProjectionState(): InlineProjectionState {
  return {
    replay: emptyProjectionReplayState(),
    entity: emptyEntityProjectionReplayState(),
  };
}

export async function projectPayloadsIntoWriter(
  writer: SvmProjectionWriter,
  payloads: readonly StructuredPayloadDraft[],
  state?: InlineProjectionState,
  metadataSnapshots: readonly MetadataSnapshotDraft[] = [],
): Promise<InlineProjectionState> {
  const inline = state ?? emptyInlineProjectionState();
  if (metadataSnapshots.length > 0) {
    loadMetadataSnapshotsIntoState(
      metadataSnapshots.map((s) => ({
        id: s.id,
        namespace: s.namespace,
        uri: s.uri,
        content_sha256: s.contentSha256,
        parsed_json: s.parsedJson,
        source_payload_id: s.sourcePayloadId,
        slot: s.slot,
        status: s.status,
      })),
      inline.entity,
    );
  }

  for (const raw of payloads) {
    const batch = projectStructuredPayload(raw, inline.replay, inline.entity);
    if (!batch) continue;
    await writer.insertPassportRecords(batch.passportRecords);
    await writer.insertPassportUriHistoryRows(batch.uriHistory);
    await writer.insertCustodyDeterminingEvents(batch.custodyEvents);
  }

  const finalized = finalizeEntityProjectionState(inline.entity);
  await writer.upsertPassportEntities(finalized);

  return inline;
}

export type ProjectionProjector = {
  projectPayloads: (
    payloads: readonly StructuredPayloadDraft[],
    metadataSnapshots?: readonly MetadataSnapshotDraft[],
  ) => Promise<void>;
};

export function createProjectionProjector(
  _pool: pg.Pool,
  writer: SvmProjectionWriter,
): ProjectionProjector {
  let state = emptyInlineProjectionState();
  return {
    async projectPayloads(payloads, metadataSnapshots = []) {
      state = await projectPayloadsIntoWriter(
        writer,
        payloads,
        state,
        metadataSnapshots,
      );
    },
  };
}
