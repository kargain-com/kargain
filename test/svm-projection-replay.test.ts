/**
 * SVM projection inline vs rebuild path parity — chain-free from raw fixtures.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  emptyProjectionReplayState,
  projectStructuredPayload,
  projectStructuredPayloadsOrdered,
  type PassportEntityProjectionDraft,
  type PassportRecordProjectionDraft,
  type PassportUriHistoryProjectionDraft,
  type RawPayloadForProjection,
} from "../lib/svm/project-raw-to-projection.js";
import type { MetadataSnapshotRow } from "../lib/svm/raw-replay-digest.js";
import { ingestBlockFromFixture } from "../src/svm-ingest/ingest-loop.js";
import { rebuildProjectionFromRaw } from "../src/svm-ingest/projection-rebuild.js";
import { projectPayloadsIntoWriter, emptyInlineProjectionState } from "../src/svm-ingest/projection-projector.js";
import {
  FIXTURE_BLOCK_ENTITY_MINT,
  FIXTURE_BLOCK_PROVENANCE,
  FIXTURE_BLOCK_URI_V2,
  FIXTURE_FOLLOWED_PROGRAMS,
  FIXTURE_METADATA_JSON,
  FIXTURE_NAMESPACE,
  fixtureMetadataFetcher,
} from "./fixtures/svm-ingest/fixture-block.js";
import { createMemorySvmProjectionWriter } from "./svm-projection-memory-writer.js";
import { createMemorySvmRawWriter } from "./svm-ingest-memory-writer.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

type ProjectionSnapshot = {
  passportRecords: Array<{
    id: string;
    tokenId: string;
    chainId: number;
    author: string;
    recordType: string;
    description: string;
    evidenceCID: string;
    timestamp: string;
  }>;
  uriHistory: Array<{
    id: string;
    tokenId: string;
    chainId: number;
    previousUri: string;
    newUri: string;
    author: string;
    verificationReset: boolean;
    timestamp: string;
  }>;
  passports: Array<Record<string, string | number | boolean | null>>;
};

function snapshotRecord(row: PassportRecordProjectionDraft) {
  return {
    id: row.id,
    tokenId: row.tokenId,
    chainId: row.chainId,
    author: row.author,
    recordType: row.recordType,
    description: row.description,
    evidenceCID: row.evidenceCID,
    timestamp: row.timestamp.toString(),
  };
}

function snapshotUri(row: PassportUriHistoryProjectionDraft) {
  return {
    id: row.id,
    tokenId: row.tokenId,
    chainId: row.chainId,
    previousUri: row.previousUri,
    newUri: row.newUri,
    author: row.author,
    verificationReset: row.verificationReset,
    timestamp: row.timestamp.toString(),
  };
}

function snapshotPassport(row: PassportEntityProjectionDraft) {
  return {
    id: row.id,
    chainId: row.chainId,
    owner: row.owner,
    status: row.status,
    tokenUri: row.tokenUri,
    vin: row.vin,
    make: row.make,
    model: row.model,
    year: row.year,
    mileageKm: row.mileageKm,
    duplicateVin: row.duplicateVin,
    createdAt: row.createdAt.toString(),
    updatedAt: row.updatedAt.toString(),
  };
}

function snapshotProjectionWriter(
  writer: ReturnType<typeof createMemorySvmProjectionWriter>,
): ProjectionSnapshot {
  return {
    passportRecords: writer.passportRecords.map(snapshotRecord).sort((a, b) => a.id.localeCompare(b.id)),
    uriHistory: writer.uriHistory.map(snapshotUri).sort((a, b) => a.id.localeCompare(b.id)),
    passports: writer.passports.map(snapshotPassport).sort((a, b) => a.id.localeCompare(b.id)),
  };
}

function metadataRowsFromRawWriter(
  rawWriter: ReturnType<typeof createMemorySvmRawWriter>,
): MetadataSnapshotRow[] {
  return rawWriter.metadataSnapshots.map((s) => ({
    id: s.id,
    namespace: s.namespace,
    uri: s.uri,
    content_sha256: s.contentSha256,
    parsed_json: s.parsedJson,
    source_payload_id: s.sourcePayloadId,
    slot: s.slot,
    status: s.status,
  }));
}

async function rebuildProjectionIntoWriter(
  writer: ReturnType<typeof createMemorySvmProjectionWriter>,
  payloads: readonly RawPayloadForProjection[],
  metadataSnapshots: readonly MetadataSnapshotRow[] = [],
): Promise<void> {
  const batch = projectStructuredPayloadsOrdered(payloads, metadataSnapshots);
  await writer.insertPassportRecords(batch.passportRecords);
  await writer.insertPassportUriHistoryRows(batch.uriHistory);
  await writer.upsertPassportEntities(batch.passports);
}

function assertProjectionPathsEqual(
  inline: ProjectionSnapshot,
  rebuild: ProjectionSnapshot,
): void {
  assert.deepEqual(rebuild.passportRecords, inline.passportRecords);
  assert.deepEqual(rebuild.uriHistory, inline.uriHistory);
  assert.deepEqual(rebuild.passports, inline.passports);
}

async function ingestInlineProjection(
  blocks: Array<{ slot: number; transactions: typeof FIXTURE_BLOCK_PROVENANCE.transactions }>,
  metadataFetcher = fixtureMetadataFetcher(),
): Promise<{
  rawWriter: ReturnType<typeof createMemorySvmRawWriter>;
  inlineWriter: ReturnType<typeof createMemorySvmProjectionWriter>;
}> {
  const rawWriter = createMemorySvmRawWriter();
  const inlineWriter = createMemorySvmProjectionWriter();
  let inlineState = emptyInlineProjectionState();
  const projector = {
    projectPayloads: async (
      payloads: readonly (typeof rawWriter.payloads)[number][],
      snapshots?: readonly (typeof rawWriter.metadataSnapshots)[number][],
    ) => {
      inlineState = await projectPayloadsIntoWriter(
        inlineWriter,
        [...payloads],
        inlineState,
        snapshots ? [...snapshots] : [],
      );
    },
  };

  let lastSlot = blocks[0]!.slot - 1;
  for (const block of blocks) {
    await ingestBlockFromFixture({
      namespace: FIXTURE_NAMESPACE,
      block,
      followedPrograms: FIXTURE_FOLLOWED_PROGRAMS,
      writer: rawWriter,
      projector,
      lastContiguousSlot: lastSlot,
      metadataFetcher,
    });
    lastSlot = block.slot;
  }

  return { rawWriter, inlineWriter };
}

/** Simulates a broken rebuild that drops URI replay state between rows. */
function projectBrokenRebuildWithoutUriState(
  rows: readonly RawPayloadForProjection[],
  metadataSnapshots: readonly MetadataSnapshotRow[],
): ProjectionSnapshot {
  const passportRecords: PassportRecordProjectionDraft[] = [];
  const uriHistory: PassportUriHistoryProjectionDraft[] = [];
  const sorted = [...rows].sort((a, b) => {
    if (a.namespace !== b.namespace) return a.namespace - b.namespace;
    if (a.slot !== b.slot) return a.slot - b.slot;
    if (a.txIndexInBlock !== b.txIndexInBlock) {
      return a.txIndexInBlock - b.txIndexInBlock;
    }
    return a.logIndex - b.logIndex;
  });
  for (const raw of sorted) {
    const batch = projectStructuredPayload(raw, emptyProjectionReplayState());
    if (!batch) continue;
    passportRecords.push(...batch.passportRecords);
    uriHistory.push(...batch.uriHistory);
  }
  const full = projectStructuredPayloadsOrdered(sorted, metadataSnapshots);
  return {
    passportRecords: passportRecords.map(snapshotRecord).sort((a, b) => a.id.localeCompare(b.id)),
    uriHistory: uriHistory.map(snapshotUri).sort((a, b) => a.id.localeCompare(b.id)),
    passports: full.passports.map(snapshotPassport).sort((a, b) => a.id.localeCompare(b.id)),
  };
}

describe("svm projection replay", () => {
  it("projects RecordAppended + PassportURIUpdated from fixture block", async () => {
    const { inlineWriter, rawWriter } = await ingestInlineProjection([FIXTURE_BLOCK_PROVENANCE]);

    assert.equal(rawWriter.payloads.length, 2);
    assert.equal(inlineWriter.passportRecords.length, 1);
    assert.equal(inlineWriter.uriHistory.length, 1);
    assert.equal(inlineWriter.passportRecords[0]?.chainId, FIXTURE_NAMESPACE);
    assert.equal(inlineWriter.uriHistory[0]?.previousUri, "");
    assert.equal(inlineWriter.uriHistory[0]?.newUri, "ar://svm-uri-v1");
  });

  it("inline projection rows match full rebuild from the same raw payloads", async () => {
    const { rawWriter, inlineWriter } = await ingestInlineProjection([
      FIXTURE_BLOCK_PROVENANCE,
      FIXTURE_BLOCK_URI_V2,
    ]);

    const rebuildWriter = createMemorySvmProjectionWriter();
    await rebuildProjectionIntoWriter(
      rebuildWriter,
      rawWriter.payloads,
      metadataRowsFromRawWriter(rawWriter),
    );

    assertProjectionPathsEqual(
      snapshotProjectionWriter(inlineWriter),
      snapshotProjectionWriter(rebuildWriter),
    );
    assert.equal(rawWriter.payloads.length, 3);
    assert.equal(inlineWriter.uriHistory.length, 2);
    assert.equal(inlineWriter.uriHistory[1]?.previousUri, "ar://svm-uri-v1");
    assert.equal(inlineWriter.uriHistory[1]?.newUri, "ar://svm-uri-v2");
  });

  it("passport entity inline matches rebuild with metadata snapshots", async () => {
    const { rawWriter, inlineWriter } = await ingestInlineProjection([
      FIXTURE_BLOCK_ENTITY_MINT,
    ]);

    assert.equal(rawWriter.metadataSnapshots.length, 1);
    assert.equal(inlineWriter.passports.length, 1);
    assert.equal(inlineWriter.passports[0]?.vin, FIXTURE_METADATA_JSON.vin);
    assert.equal(inlineWriter.passports[0]?.make, FIXTURE_METADATA_JSON.make);

    const rebuildWriter = createMemorySvmProjectionWriter();
    await rebuildProjectionIntoWriter(
      rebuildWriter,
      rawWriter.payloads,
      metadataRowsFromRawWriter(rawWriter),
    );

    assertProjectionPathsEqual(
      snapshotProjectionWriter(inlineWriter),
      snapshotProjectionWriter(rebuildWriter),
    );
  });

  it("negative control: path equality fails when rebuild drops URI replay state", async () => {
    const { rawWriter, inlineWriter } = await ingestInlineProjection([
      FIXTURE_BLOCK_PROVENANCE,
      FIXTURE_BLOCK_URI_V2,
    ]);
    const inlineSnapshot = snapshotProjectionWriter(inlineWriter);
    const brokenRebuild = projectBrokenRebuildWithoutUriState(
      rawWriter.payloads,
      metadataRowsFromRawWriter(rawWriter),
    );

    assert.notDeepEqual(brokenRebuild.uriHistory, inlineSnapshot.uriHistory);
    assert.throws(
      () => assertProjectionPathsEqual(inlineSnapshot, brokenRebuild),
      assert.AssertionError,
    );
    assert.equal(brokenRebuild.uriHistory[1]?.previousUri, "");
    assert.equal(inlineSnapshot.uriHistory[1]?.previousUri, "ar://svm-uri-v1");
  });

  it("rebuild module does not import rpc client", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "src/svm-ingest/projection-rebuild.ts"),
      "utf8",
    );
    assert.ok(!src.includes("rpc-client"));
    assert.ok(!src.includes("SvmRpcClient"));
  });

  it("rebuildProjectionFromRaw is exported for pg integration", () => {
    assert.equal(typeof rebuildProjectionFromRaw, "function");
  });
});
