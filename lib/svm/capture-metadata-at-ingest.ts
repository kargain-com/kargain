/**
 * Inline-only metadata capture for SVM ingest (S7c-4). Never called from rebuild.
 */

import type { IndexedPassportMetadata } from "@/lib/passport/index-passport-metadata";
import { fetchMetadataFromUri } from "@/lib/passport/index-passport-metadata";

import type { StructuredPayloadDraft } from "./parse-transaction-ingest.js";
import { uriFromStructuredPayload } from "./extract-uri-from-payload.js";
import {
  denormFromParsedJson,
  metadataSnapshotRowId,
  sha256Hex,
  type MetadataSnapshotDraft,
} from "./metadata-snapshot.js";

export type MetadataFetchResult =
  | { status: "captured"; rawJson: unknown; denorm: IndexedPassportMetadata }
  | { status: "unavailable"; reason: string };

export type MetadataFetcher = (uri: string) => Promise<MetadataFetchResult>;

async function defaultMetadataFetcher(uri: string): Promise<MetadataFetchResult> {
  const urlResult = await fetchMetadataFromUri(uri);
  if (!urlResult) {
    return { status: "unavailable", reason: "fetch_or_parse_failed" };
  }
  return {
    status: "captured",
    rawJson: urlResult,
    denorm: urlResult,
  };
}

/** Test hook — rebuild path must not import this module. */
export async function fetchMetadataForUri(
  uri: string,
  fetcher: MetadataFetcher = defaultMetadataFetcher,
): Promise<MetadataFetchResult> {
  return fetcher(uri);
}

export async function buildMetadataSnapshotDraft(args: {
  payload: StructuredPayloadDraft;
  fetcher?: MetadataFetcher;
}): Promise<MetadataSnapshotDraft | null> {
  const uri = uriFromStructuredPayload(args.payload);
  if (!uri) return null;

  const fetcher = args.fetcher ?? defaultMetadataFetcher;
  const result = await fetchMetadataForUri(uri, fetcher);

  if (result.status === "unavailable") {
    return {
      id: metadataSnapshotRowId({
        namespace: args.payload.namespace,
        uri,
        contentSha256: "unavailable",
      }),
      namespace: args.payload.namespace,
      uri,
      contentSha256: "unavailable",
      parsedJson: null,
      denorm: null,
      sourcePayloadId: args.payload.id,
      slot: args.payload.slot,
      status: "unavailable",
    };
  }

  let parsedRecord: Record<string, unknown>;
  if (
    result.rawJson &&
    typeof result.rawJson === "object" &&
    !Array.isArray(result.rawJson)
  ) {
    parsedRecord = result.rawJson as Record<string, unknown>;
  } else {
    parsedRecord = { ...result.denorm };
  }

  const rawBytes = Buffer.from(JSON.stringify(parsedRecord), "utf8");
  const contentSha256 = sha256Hex(rawBytes);

  return {
    id: metadataSnapshotRowId({
      namespace: args.payload.namespace,
      uri,
      contentSha256,
    }),
    namespace: args.payload.namespace,
    uri,
    contentSha256,
    parsedJson: parsedRecord,
    denorm: result.denorm ?? denormFromParsedJson(parsedRecord),
    sourcePayloadId: args.payload.id,
    slot: args.payload.slot,
    status: "captured",
  };
}
