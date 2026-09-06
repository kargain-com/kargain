import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createIngestLoop } from "../src/svm-ingest/ingest-loop.js";
import type { SvmRpcClient } from "../src/svm-ingest/rpc-client.js";
import {
  FIXTURE_BLOCK,
  FIXTURE_FOLLOWED_PROGRAMS,
  FIXTURE_NAMESPACE,
} from "./fixtures/svm-ingest/fixture-block.js";
import { createMemorySvmRawWriter } from "./svm-ingest-memory-writer.js";

function emptyBlock(slot: number) {
  return { slot, transactions: [] };
}

describe("svm ingest loop bootstrap and retention", () => {
  it("bootstrap catch-up is distinct from lag incident and clears only after reaching head", async () => {
    const startSlot = FIXTURE_BLOCK.slot;
    const headSlot = startSlot + 2;
    const rpc: SvmRpcClient = {
      async getSlot() {
        return headSlot;
      },
      async getFirstAvailableBlock() {
        return startSlot;
      },
      async getBlock(slot) {
        if (slot === FIXTURE_BLOCK.slot) return FIXTURE_BLOCK;
        if (slot === startSlot + 1) return emptyBlock(slot);
        if (slot === headSlot) return emptyBlock(slot);
        return null;
      },
    };
    const writer = createMemorySvmRawWriter();
    const loop = createIngestLoop({
      namespace: FIXTURE_NAMESPACE,
      startSlot,
      maxLagSlots: 1,
      followedPrograms: FIXTURE_FOLLOWED_PROGRAMS,
      writer,
      rpc,
    });

    await loop.initCursor();
    assert.deepEqual(await writer.getCursor(FIXTURE_NAMESPACE), {
      lastContiguousSlot: startSlot - 1,
      bootstrapState: "historical_backfill",
      catchupIncident: null,
    });

    await loop.catchUpToHead();

    const state = loop.getState();
    assert.equal(state.bootstrapState, null);
    assert.equal(state.catchupIncident, null);
    assert.equal(state.lastContiguousSlot, headSlot);
    assert.equal(loop.isReady(), true);
  });

  it("post-bootstrap lag still raises catchup_window_exceeded", async () => {
    const startSlot = FIXTURE_BLOCK.slot;
    let headSlot = startSlot;
    const rpc: SvmRpcClient = {
      async getSlot() {
        return headSlot;
      },
      async getFirstAvailableBlock() {
        return startSlot;
      },
      async getBlock(slot) {
        if (slot === FIXTURE_BLOCK.slot) return FIXTURE_BLOCK;
        return emptyBlock(slot);
      },
    };
    const writer = createMemorySvmRawWriter();
    const loop = createIngestLoop({
      namespace: FIXTURE_NAMESPACE,
      startSlot,
      maxLagSlots: 2,
      followedPrograms: FIXTURE_FOLLOWED_PROGRAMS,
      writer,
      rpc,
    });

    await loop.initCursor();
    await loop.catchUpToHead();
    assert.equal(loop.getState().bootstrapState, null);

    headSlot = startSlot + 10;
    await loop.followOnce();

    const state = loop.getState();
    assert.equal(state.bootstrapState, null);
    assert.equal(state.catchupIncident, "catchup_window_exceeded");
    assert.equal(loop.isReady(), false);
    assert.equal(writer.refusals.at(-1)?.detail.incident, "catchup_window_exceeded");
  });

  it("startup retention assertion refuses by name when rpc cannot serve the required slot", async () => {
    const startSlot = FIXTURE_BLOCK.slot;
    const rpc: SvmRpcClient = {
      async getSlot() {
        return startSlot + 1;
      },
      async getFirstAvailableBlock() {
        return startSlot + 1;
      },
      async getBlock(slot) {
        if (slot === FIXTURE_BLOCK.slot) return FIXTURE_BLOCK;
        return emptyBlock(slot);
      },
    };
    const writer = createMemorySvmRawWriter();
    const loop = createIngestLoop({
      namespace: FIXTURE_NAMESPACE,
      startSlot,
      maxLagSlots: 10,
      followedPrograms: FIXTURE_FOLLOWED_PROGRAMS,
      writer,
      rpc,
    });

    await loop.initCursor();
    await assert.rejects(
      () => loop.catchUpToHead(),
      /required slot .* before first available block/,
    );

    const state = loop.getState();
    assert.equal(state.catchupIncident, "startup_retention_unavailable");
    assert.equal(state.bootstrapState, "historical_backfill");
    assert.equal(
      writer.refusals.at(-1)?.detail.reason,
      "required_slot_before_first_available_block",
    );
    assert.equal(writer.refusals.at(-1)?.detail.requiredSlot, startSlot);
    assert.equal(writer.refusals.at(-1)?.detail.firstAvailableBlock, startSlot + 1);
  });
});
