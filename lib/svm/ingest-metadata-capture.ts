/**
 * Inline ingest hook — capture metadata snapshots after structured_payload write (S7c-4).
 * Not imported by projection rebuild.
 */

import {
  buildMetadataSnapshotDraft,
  type MetadataFetcher,
} from "./capture-metadata-at-ingest.js";
import type { StructuredPayloadDraft } from "./parse-transaction-ingest.js";
import type { MetadataSnapshotDraft } from "./metadata-snapshot.js";
import { uriFromStructuredPayload } from "./extract-uri-from-payload.js";

export async function metadataSnapshotsForPayloads(args: {
  payloads: readonly StructuredPayloadDraft[];
  fetcher?: MetadataFetcher;
}): Promise<MetadataSnapshotDraft[]> {
  const out: MetadataSnapshotDraft[] = [];
  for (const payload of args.payloads) {
    if (!uriFromStructuredPayload(payload)) continue;
    const draft = await buildMetadataSnapshotDraft({
      payload,
      fetcher: args.fetcher,
    });
    if (draft) out.push(draft);
  }
  return out;
}
