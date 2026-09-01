/**
 * In-memory writer for ingest tests + chain-free replay digest proof.
 */
import type {
  IngestRefusalDraft,
  StructuredPayloadDraft,
} from "../lib/svm/parse-transaction-ingest.js";
import type { MetadataSnapshotDraft } from "../lib/svm/metadata-snapshot.js";
import type { SvmRawWriter } from "../src/lib/svm-raw-writer.js";

export function createMemorySvmRawWriter(): SvmRawWriter & {
  payloads: StructuredPayloadDraft[];
  metadataSnapshots: MetadataSnapshotDraft[];
  refusals: IngestRefusalDraft[];
} {
  const payloads: StructuredPayloadDraft[] = [];
  const metadataSnapshots: MetadataSnapshotDraft[] = [];
  const refusals: IngestRefusalDraft[] = [];
  let cursor: { lastContiguousSlot: number; catchupIncident: string | null } | null =
    null;

  return {
    payloads,
    metadataSnapshots,
    refusals,
    async insertStructuredPayload(row) {
      if (payloads.some((p) => p.id === row.id)) return false;
      payloads.push(row);
      return true;
    },
    async insertMetadataSnapshot(row) {
      if (metadataSnapshots.some((s) => s.id === row.id)) return false;
      metadataSnapshots.push(row);
      return true;
    },
    async insertIngestRefusal(row) {
      if (refusals.some((r) => r.id === row.id)) return false;
      refusals.push(row);
      return true;
    },
    async insertStructuredPayloads(rows) {
      let n = 0;
      for (const row of rows) {
        if (await this.insertStructuredPayload(row)) n += 1;
      }
      return n;
    },
    async insertMetadataSnapshots(rows) {
      let n = 0;
      for (const row of rows) {
        if (await this.insertMetadataSnapshot(row)) n += 1;
      }
      return n;
    },
    async insertIngestRefusals(rows) {
      let n = 0;
      for (const row of rows) {
        if (await this.insertIngestRefusal(row)) n += 1;
      }
      return n;
    },
    async getCursor(namespace) {
      void namespace;
      if (!cursor) return null;
      return { ...cursor };
    },
    async upsertCursor(args) {
      void args.namespace;
      cursor = {
        lastContiguousSlot: args.lastContiguousSlot,
        catchupIncident: args.catchupIncident,
      };
    },
  };
}
