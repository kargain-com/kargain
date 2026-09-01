/**
 * SVM projection rebuild digest — chain-free from raw fixtures.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { projectStructuredPayloadsOrdered } from "../lib/svm/project-raw-to-projection.js";
import { digestProjectionRows } from "../lib/svm/projection-replay-digest.js";
import { ingestBlockFromFixture } from "../src/svm-ingest/ingest-loop.js";
import { rebuildProjectionFromRaw } from "../src/svm-ingest/projection-rebuild.js";
import { projectPayloadsIntoWriter } from "../src/svm-ingest/projection-projector.js";
import {
  FIXTURE_BLOCK_PROVENANCE,
  FIXTURE_FOLLOWED_PROGRAMS,
  FIXTURE_NAMESPACE,
} from "./fixtures/svm-ingest/fixture-block.js";
import { createMemorySvmProjectionWriter } from "./svm-projection-memory-writer.js";
import { createMemorySvmRawWriter } from "./svm-ingest-memory-writer.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function projectionDigestFromBatch(
  batch: ReturnType<typeof projectStructuredPayloadsOrdered>,
): string {
  return digestProjectionRows({
    records: batch.passportRecords.map((r) => ({
      id: r.id,
      token_id: r.tokenId,
      chain_id: r.chainId,
      author: r.author,
      record_type: r.recordType,
      description: r.description,
      evidence_cid: r.evidenceCID,
      timestamp: r.timestamp.toString(),
    })),
    uriHistory: batch.uriHistory.map((r) => ({
      id: r.id,
      token_id: r.tokenId,
      chain_id: r.chainId,
      previous_uri: r.previousUri,
      new_uri: r.newUri,
      author: r.author,
      verification_reset: r.verificationReset,
      timestamp: r.timestamp.toString(),
    })),
  });
}

describe("svm projection replay", () => {
  it("projects RecordAppended + PassportURIUpdated from fixture block", async () => {
    const rawWriter = createMemorySvmRawWriter();
    const projectionWriter = createMemorySvmProjectionWriter();
    const projector = {
      projectPayloads: async (payloads: typeof rawWriter.payloads) => {
        await projectPayloadsIntoWriter(projectionWriter, payloads);
      },
    };

    await ingestBlockFromFixture({
      namespace: FIXTURE_NAMESPACE,
      block: FIXTURE_BLOCK_PROVENANCE,
      followedPrograms: FIXTURE_FOLLOWED_PROGRAMS,
      writer: rawWriter,
      projector,
      lastContiguousSlot: FIXTURE_BLOCK_PROVENANCE.slot - 1,
    });

    assert.equal(rawWriter.payloads.length, 2);
    assert.equal(projectionWriter.passportRecords.length, 1);
    assert.equal(projectionWriter.uriHistory.length, 1);
    assert.equal(projectionWriter.passportRecords[0]?.chainId, FIXTURE_NAMESPACE);
    assert.equal(projectionWriter.uriHistory[0]?.previousUri, "");
    assert.equal(projectionWriter.uriHistory[0]?.newUri, "ar://svm-uri-v1");
  });

  it("digest is stable across two rebuilds from the same raw batch", async () => {
    const rawWriter = createMemorySvmRawWriter();
    await ingestBlockFromFixture({
      namespace: FIXTURE_NAMESPACE,
      block: FIXTURE_BLOCK_PROVENANCE,
      followedPrograms: FIXTURE_FOLLOWED_PROGRAMS,
      writer: rawWriter,
      lastContiguousSlot: FIXTURE_BLOCK_PROVENANCE.slot - 1,
    });

    const batch = projectStructuredPayloadsOrdered(rawWriter.payloads);
    const digestA = projectionDigestFromBatch(batch);
    const digestB = projectionDigestFromBatch(
      projectStructuredPayloadsOrdered(rawWriter.payloads),
    );
    assert.equal(digestA, digestB);
    assert.notEqual(digestA, "");
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
