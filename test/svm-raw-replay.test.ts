/**
 * Rebuild digest equals live ingest without chain RPC.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { digestStructuredPayloadRows } from "../lib/svm/raw-replay-digest.js";
import { ingestBlockFromFixture } from "../src/svm-ingest/ingest-loop.js";
import type { SvmRpcClient } from "../src/svm-ingest/rpc-client.js";
import { createIngestLoop } from "../src/svm-ingest/ingest-loop.js";
import {
  FIXTURE_BLOCK,
  FIXTURE_FOLLOWED_PROGRAMS,
  FIXTURE_NAMESPACE,
} from "./fixtures/svm-ingest/fixture-block.js";
import { createMemorySvmRawWriter } from "./svm-ingest-memory-writer.js";

function rowsFromMemoryWriter(
  writer: ReturnType<typeof createMemorySvmRawWriter>,
): Parameters<typeof digestStructuredPayloadRows>[0] {
  return writer.payloads
    .map((p) => ({
      id: p.id,
      namespace: p.namespace,
      slot: p.slot,
      tx_index_in_block: p.txIndexInBlock,
      log_index: p.logIndex,
      tx_signature: p.txSignature,
      emitting_program: p.emittingProgram,
      discriminator: p.discriminator,
      event_name: p.eventName,
      contract_name: p.contractName,
      payload_bytes: p.payloadBytes,
    }))
    .sort((a, b) => {
      if (a.slot !== b.slot) return a.slot - b.slot;
      if (a.tx_index_in_block !== b.tx_index_in_block) {
        return a.tx_index_in_block - b.tx_index_in_block;
      }
      return a.log_index - b.log_index;
    });
}

describe("svm raw replay digest", () => {
  it("fixture ingest digest matches replay-from-store without RPC", async () => {
    const writer = createMemorySvmRawWriter();
    await ingestBlockFromFixture({
      namespace: FIXTURE_NAMESPACE,
      block: FIXTURE_BLOCK,
      followedPrograms: FIXTURE_FOLLOWED_PROGRAMS,
      writer,
      lastContiguousSlot: FIXTURE_BLOCK.slot - 1,
    });

    const digestLive = digestStructuredPayloadRows(rowsFromMemoryWriter(writer));

    const replayWriter = createMemorySvmRawWriter();
    for (const row of writer.payloads) {
      await replayWriter.insertStructuredPayload(row);
    }
    const digestReplay = digestStructuredPayloadRows(rowsFromMemoryWriter(replayWriter));

    assert.equal(digestLive, digestReplay);
    assert.equal(writer.payloads.length, 1);
  });

  it("catch-up loop refuses RPC when stub throws", async () => {
    let rpcCalls = 0;
    const rpc: SvmRpcClient = {
      callCounts: {
        getBlock: 0,
        getSignaturesForAddress: 0,
        getSlot: 0,
        getFirstAvailableBlock: 0,
      },
      async getSlot() {
        rpcCalls += 1;
        throw new Error("chain access removed");
      },
      async getFirstAvailableBlock() {
        rpcCalls += 1;
        throw new Error("chain access removed");
      },
      async getBlock() {
        rpcCalls += 1;
        throw new Error("chain access removed");
      },
      async getSignaturesForAddress() {
        rpcCalls += 1;
        throw new Error("chain access removed");
      },
    };
    const writer = createMemorySvmRawWriter();
    const loop = createIngestLoop({
      namespace: FIXTURE_NAMESPACE,
      startSlot: FIXTURE_BLOCK.slot,
      maxLagSlots: 216_000,
      followedPrograms: FIXTURE_FOLLOWED_PROGRAMS,
      writer,
      rpc,
    });
    await loop.initCursor();
    await assert.rejects(() => loop.catchUpToHead(), /chain access removed/);
    assert.equal(rpcCalls, 1);
  });
});
