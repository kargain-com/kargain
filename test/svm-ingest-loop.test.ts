/**
 * Signature-discovery ingest loop — bootstrap, lag, retention, missing block.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isRetriableCatchupIncident,
  RETRIABLE_CATCHUP_INCIDENTS,
  structuredPayloadRowId,
} from "../lib/svm/ingest-refusal.js";
import { discoverIngestSlots } from "../lib/svm/ingest-slot-discovery.js";
import { createIngestLoop } from "../src/svm-ingest/ingest-loop.js";
import {
  SvmIngestRpcBudgetExhaustedError,
  with429Backoff,
  type FetchedBlock,
  type GetBlockOutcome,
  type SignatureInfo,
  type SvmRpcClient,
} from "../src/svm-ingest/rpc-client.js";
import {
  FIXTURE_BLOCK,
  FIXTURE_FOLLOWED_PROGRAMS,
  FIXTURE_NAMESPACE,
  FIXTURE_PASSPORT_PROGRAM,
  passportMintedProgramDataLine,
  recordAppendedProgramDataLine,
} from "./fixtures/svm-ingest/fixture-block.js";
import { createMemorySvmRawWriter } from "./svm-ingest-memory-writer.js";

function emptyBlock(slot: number): FetchedBlock {
  return { slot, transactions: [] };
}

function okBlock(block: FetchedBlock): GetBlockOutcome {
  return { status: "ok", block };
}

function missingBlock(slot: number): GetBlockOutcome {
  return { status: "missing_block", slot };
}

function makeRpc(args: {
  head: number;
  firstAvailable?: number;
  signaturesByProgram?: Record<string, SignatureInfo[]>;
  blocks?: Record<number, GetBlockOutcome | FetchedBlock>;
  onSignaturesPage?: () => void;
  failSignatures?: boolean;
  getBlockImpl?: (slot: number) => Promise<GetBlockOutcome>;
}): SvmRpcClient {
  const callCounts = {
    getBlock: 0,
    getSignaturesForAddress: 0,
    getSlot: 0,
    getFirstAvailableBlock: 0,
  };
  return {
    callCounts,
    async getSlot() {
      callCounts.getSlot += 1;
      return args.head;
    },
    async getFirstAvailableBlock() {
      callCounts.getFirstAvailableBlock += 1;
      return args.firstAvailable ?? FIXTURE_FOLLOWED_PROGRAMS[0]!.deploySlot;
    },
    async getSignaturesForAddress(programId, opts) {
      callCounts.getSignaturesForAddress += 1;
      args.onSignaturesPage?.();
      if (args.failSignatures) {
        throw new Error("planted pagination failure");
      }
      const all = [...(args.signaturesByProgram?.[programId] ?? [])].sort(
        (a, b) => b.slot - a.slot,
      );
      let start = 0;
      if (opts?.before) {
        const idx = all.findIndex((r) => r.signature === opts.before);
        start = idx >= 0 ? idx + 1 : all.length;
      }
      const limit = opts?.limit ?? 1000;
      return all.slice(start, start + limit);
    },
    async getBlock(slot) {
      callCounts.getBlock += 1;
      if (args.getBlockImpl) return args.getBlockImpl(slot);
      const raw = args.blocks?.[slot];
      if (!raw) return missingBlock(slot);
      if ("status" in raw) return raw;
      return okBlock(raw);
    },
  };
}

describe("svm ingest loop — signature discovery", () => {
  it("shape justifier: two txs in one slot → two distinct ids; placeholder index collapses", async () => {
    const slot = FIXTURE_BLOCK.slot;
    const twoTxBlock: FetchedBlock = {
      slot,
      transactions: [
        {
          signature: "sigA111111111111111111111111111111111111111111111111111",
          metaErr: null,
          logMessages: [
            `Program ${FIXTURE_PASSPORT_PROGRAM} invoke [1]`,
            passportMintedProgramDataLine(),
            `Program ${FIXTURE_PASSPORT_PROGRAM} success`,
          ],
        },
        {
          signature: "sigB222222222222222222222222222222222222222222222222222",
          metaErr: null,
          logMessages: [
            `Program ${FIXTURE_PASSPORT_PROGRAM} invoke [1]`,
            recordAppendedProgramDataLine(),
            `Program ${FIXTURE_PASSPORT_PROGRAM} success`,
          ],
        },
      ],
    };

    const writer = createMemorySvmRawWriter();
    const rpc = makeRpc({
      head: slot + 5,
      signaturesByProgram: {
        [FIXTURE_PASSPORT_PROGRAM]: [
          { signature: twoTxBlock.transactions[0]!.signature, slot },
          { signature: twoTxBlock.transactions[1]!.signature, slot },
        ],
      },
      blocks: { [slot]: twoTxBlock },
    });
    const loop = createIngestLoop({
      namespace: FIXTURE_NAMESPACE,
      startSlot: FIXTURE_FOLLOWED_PROGRAMS[0]!.deploySlot,
      maxLagSlots: 216_000,
      followedPrograms: FIXTURE_FOLLOWED_PROGRAMS,
      writer,
      rpc,
    });
    await loop.initCursor();
    await loop.catchUpToHead();

    assert.equal(loop.isReady(), true);
    assert.ok(writer.payloads.length >= 2);
    const ids = new Set(writer.payloads.map((p) => p.id));
    assert.equal(ids.size, writer.payloads.length);
    assert.ok(
      writer.payloads.some((p) => p.txIndexInBlock === 0) &&
        writer.payloads.some((p) => p.txIndexInBlock === 1),
    );

    // Planted control: fake txIndex=0 for both → ON CONFLICT keeps one.
    const plantedWriter = createMemorySvmRawWriter();
    const row0 = {
      ...writer.payloads[0]!,
      id: structuredPayloadRowId({
        namespace: FIXTURE_NAMESPACE,
        slot,
        txIndexInBlock: 0,
        logIndex: writer.payloads[0]!.logIndex,
      }),
      txIndexInBlock: 0,
    };
    const row1 = {
      ...writer.payloads[1]!,
      id: structuredPayloadRowId({
        namespace: FIXTURE_NAMESPACE,
        slot,
        txIndexInBlock: 0,
        logIndex: writer.payloads[0]!.logIndex,
      }),
      txIndexInBlock: 0,
    };
    assert.equal(row0.id, row1.id);
    assert.equal(await plantedWriter.insertStructuredPayload(row0), true);
    assert.equal(await plantedWriter.insertStructuredPayload(row1), false);
    assert.equal(plantedWriter.payloads.length, 1);
  });

  it("bootstrap discovers fixture slot, clears historical_backfill without scanning empty tip", async () => {
    const startSlot = FIXTURE_FOLLOWED_PROGRAMS[0]!.deploySlot;
    const headSlot = FIXTURE_BLOCK.slot + 10_000;
    const rpc = makeRpc({
      head: headSlot,
      firstAvailable: startSlot,
      signaturesByProgram: {
        [FIXTURE_PASSPORT_PROGRAM]: [
          {
            signature: FIXTURE_BLOCK.transactions[0]!.signature,
            slot: FIXTURE_BLOCK.slot,
          },
        ],
      },
      blocks: { [FIXTURE_BLOCK.slot]: FIXTURE_BLOCK },
    });
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
    await loop.catchUpToHead();

    const state = loop.getState();
    assert.equal(state.bootstrapState, null);
    assert.equal(state.catchupIncident, null);
    assert.equal(state.lastContiguousSlot, FIXTURE_BLOCK.slot);
    assert.equal(loop.isReady(), true);
    assert.equal(rpc.callCounts.getBlock, 1);
    assert.ok(rpc.callCounts.getSignaturesForAddress >= 1);
    // Must not have scanned the empty tip gap.
    assert.ok(rpc.callCounts.getBlock < 100);
  });

  it("empty discovery completes bootstrap and parks watermark at head", async () => {
    const startSlot = 100;
    const head = 500;
    const programs = [
      {
        ...FIXTURE_FOLLOWED_PROGRAMS[0]!,
        deploySlot: startSlot,
      },
    ];
    const rpc = makeRpc({
      head,
      firstAvailable: startSlot,
      signaturesByProgram: { [FIXTURE_PASSPORT_PROGRAM]: [] },
    });
    const writer = createMemorySvmRawWriter();
    const loop = createIngestLoop({
      namespace: FIXTURE_NAMESPACE,
      startSlot,
      maxLagSlots: 10,
      followedPrograms: programs,
      writer,
      rpc,
    });
    await loop.initCursor();
    await loop.catchUpToHead();
    assert.equal(loop.getState().bootstrapState, null);
    assert.equal(loop.getState().lastContiguousSlot, head);
    assert.equal(loop.isReady(), true);
  });

  it("discovered missing block advances watermark with named outcome — no throw", async () => {
    const slot = FIXTURE_BLOCK.slot;
    const rpc = makeRpc({
      head: slot + 10,
      signaturesByProgram: {
        [FIXTURE_PASSPORT_PROGRAM]: [
          { signature: "missingSig111111111111111111111111111111111111111111", slot },
        ],
      },
      blocks: { [slot]: missingBlock(slot) },
    });
    const writer = createMemorySvmRawWriter();
    const loop = createIngestLoop({
      namespace: FIXTURE_NAMESPACE,
      startSlot: FIXTURE_FOLLOWED_PROGRAMS[0]!.deploySlot,
      maxLagSlots: 216_000,
      followedPrograms: FIXTURE_FOLLOWED_PROGRAMS,
      writer,
      rpc,
    });
    await loop.initCursor();
    await loop.catchUpToHead();
    assert.equal(loop.getState().lastContiguousSlot, slot);
    assert.equal(loop.getState().bootstrapState, null);
    assert.ok(
      writer.refusals.some(
        (r) => r.detail.reason === "discovered_slot_missing_block",
      ),
    );
  });

  it("planted incomplete signature page refuses completeness", async () => {
    const rpc = makeRpc({
      head: FIXTURE_BLOCK.slot + 10,
      failSignatures: true,
    });
    const writer = createMemorySvmRawWriter();
    const loop = createIngestLoop({
      namespace: FIXTURE_NAMESPACE,
      startSlot: FIXTURE_FOLLOWED_PROGRAMS[0]!.deploySlot,
      maxLagSlots: 216_000,
      followedPrograms: FIXTURE_FOLLOWED_PROGRAMS,
      writer,
      rpc,
    });
    await loop.initCursor();
    await loop.catchUpToHead();
    assert.equal(loop.getState().bootstrapState, "historical_backfill");
    assert.equal(loop.getState().catchupIncident, "discovery_incomplete");
    assert.equal(loop.getState().halted, false);
    assert.equal(loop.isReady(), false);
  });

  it("post-bootstrap empty tip gap does not raise catchup_window_exceeded", async () => {
    const startSlot = FIXTURE_FOLLOWED_PROGRAMS[0]!.deploySlot;
    let head = FIXTURE_BLOCK.slot;
    const callCounts = {
      getBlock: 0,
      getSignaturesForAddress: 0,
      getSlot: 0,
      getFirstAvailableBlock: 0,
    };
    const mutableRpc: SvmRpcClient = {
      callCounts,
      async getSlot() {
        callCounts.getSlot += 1;
        return head;
      },
      async getFirstAvailableBlock() {
        callCounts.getFirstAvailableBlock += 1;
        return startSlot;
      },
      async getSignaturesForAddress(programId) {
        callCounts.getSignaturesForAddress += 1;
        if (programId !== FIXTURE_PASSPORT_PROGRAM) return [];
        if (head === FIXTURE_BLOCK.slot) {
          return [
            {
              signature: FIXTURE_BLOCK.transactions[0]!.signature,
              slot: FIXTURE_BLOCK.slot,
            },
          ];
        }
        return [];
      },
      async getBlock(slot) {
        callCounts.getBlock += 1;
        if (slot === FIXTURE_BLOCK.slot) return okBlock(FIXTURE_BLOCK);
        return missingBlock(slot);
      },
    };
    const writer = createMemorySvmRawWriter();
    const loop = createIngestLoop({
      namespace: FIXTURE_NAMESPACE,
      startSlot,
      maxLagSlots: 2,
      followedPrograms: FIXTURE_FOLLOWED_PROGRAMS,
      writer,
      rpc: mutableRpc,
    });
    await loop.initCursor();
    await loop.catchUpToHead();
    assert.equal(loop.getState().bootstrapState, null);

    head = FIXTURE_BLOCK.slot + 10_000;
    await loop.followOnce();
    assert.equal(loop.getState().catchupIncident, null);
    assert.equal(loop.isReady(), true);
  });

  it("post-bootstrap backlog of old unprocessed discovered slots raises catchup_window_exceeded", async () => {
    const startSlot = FIXTURE_FOLLOWED_PROGRAMS[0]!.deploySlot;
    const oldSlot = FIXTURE_BLOCK.slot;
    const head = oldSlot + 10_000;
    const callCounts = {
      getBlock: 0,
      getSignaturesForAddress: 0,
      getSlot: 0,
      getFirstAvailableBlock: 0,
    };
    let phase: "bootstrap" | "follow" = "bootstrap";
    const rpc: SvmRpcClient = {
      callCounts,
      async getSlot() {
        callCounts.getSlot += 1;
        return phase === "bootstrap" ? oldSlot : head;
      },
      async getFirstAvailableBlock() {
        callCounts.getFirstAvailableBlock += 1;
        return startSlot;
      },
      async getSignaturesForAddress(programId) {
        callCounts.getSignaturesForAddress += 1;
        if (programId !== FIXTURE_PASSPORT_PROGRAM) return [];
        if (phase === "bootstrap") {
          return [
            {
              signature: FIXTURE_BLOCK.transactions[0]!.signature,
              slot: oldSlot,
            },
          ];
        }
        // Live poll invents an older unprocessed sibling slot behind the window.
        return [
          {
            signature: "lateOldSig1111111111111111111111111111111111111111111",
            slot: oldSlot + 1,
          },
        ];
      },
      async getBlock(slot) {
        callCounts.getBlock += 1;
        if (slot === oldSlot) return okBlock(FIXTURE_BLOCK);
        return okBlock(emptyBlock(slot));
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
    assert.equal(loop.getState().lastContiguousSlot, oldSlot);

    phase = "follow";
    await loop.followOnce();
    assert.equal(loop.getState().catchupIncident, "catchup_window_exceeded");
    assert.equal(loop.getState().halted, true);
    assert.equal(loop.isReady(), false);
    assert.equal(
      writer.refusals.at(-1)?.detail.incident,
      "catchup_window_exceeded",
    );
    // Permanent: further follow ticks are no-ops until ops clears the cursor.
    const before = writer.payloads.length;
    await loop.followOnce();
    assert.equal(writer.payloads.length, before);
    assert.equal(loop.getState().catchupIncident, "catchup_window_exceeded");
  });

  it("fixture 429 backoff is bounded and never exits the process", async () => {
    let attempts = 0;
    await assert.rejects(
      () =>
        with429Backoff(async () => {
          attempts += 1;
          throw new Error("429 Too Many Requests");
        }, 4),
      (err: unknown) =>
        err instanceof SvmIngestRpcBudgetExhaustedError &&
        /rate limit exhausted after 4 attempts/.test(err.message),
    );
    assert.equal(attempts, 4);
  });

  it("rpc_budget_exhausted is retriable — next successful follow clears incident", async () => {
    const startSlot = FIXTURE_FOLLOWED_PROGRAMS[0]!.deploySlot;
    const slot = FIXTURE_BLOCK.slot;
    const okRpc = makeRpc({
      head: slot + 5,
      signaturesByProgram: {
        [FIXTURE_PASSPORT_PROGRAM]: [
          {
            signature: FIXTURE_BLOCK.transactions[0]!.signature,
            slot,
          },
        ],
      },
      blocks: { [slot]: FIXTURE_BLOCK },
    });
    const writer = createMemorySvmRawWriter();
    const loop = createIngestLoop({
      namespace: FIXTURE_NAMESPACE,
      startSlot,
      maxLagSlots: 216_000,
      followedPrograms: FIXTURE_FOLLOWED_PROGRAMS,
      writer,
      rpc: okRpc,
    });
    await loop.initCursor();
    await loop.catchUpToHead();
    assert.equal(loop.isReady(), true);

    let failOnce = true;
    const flaky: SvmRpcClient = {
      ...okRpc,
      async getSignaturesForAddress(programId, opts) {
        if (failOnce) {
          failOnce = false;
          okRpc.callCounts.getSignaturesForAddress += 1;
          throw new SvmIngestRpcBudgetExhaustedError(
            "Solana RPC rate limit exhausted after 6 attempts: planted",
          );
        }
        return okRpc.getSignaturesForAddress(programId, opts);
      },
    };
    const followLoop = createIngestLoop({
      namespace: FIXTURE_NAMESPACE,
      startSlot,
      maxLagSlots: 216_000,
      followedPrograms: FIXTURE_FOLLOWED_PROGRAMS,
      writer,
      rpc: flaky,
    });
    await followLoop.initCursor();
    assert.equal(followLoop.getState().bootstrapState, null);

    await followLoop.followOnce();
    assert.equal(followLoop.getState().catchupIncident, "rpc_budget_exhausted");
    assert.equal(followLoop.getState().halted, false);
    assert.equal(followLoop.isReady(), false);

    await followLoop.followOnce();
    assert.equal(followLoop.getState().catchupIncident, null);
    assert.equal(followLoop.isReady(), true);
  });

  it("startup retention assertion refuses by name when rpc cannot serve the required slot", async () => {
    const startSlot = FIXTURE_FOLLOWED_PROGRAMS[0]!.deploySlot;
    const rpc = makeRpc({
      head: startSlot + 10,
      firstAvailable: startSlot + 1,
      signaturesByProgram: { [FIXTURE_PASSPORT_PROGRAM]: [] },
    });
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
    assert.equal(
      loop.getState().catchupIncident,
      "startup_retention_unavailable",
    );
    assert.equal(loop.getState().halted, true);
    assert.equal(loop.getState().bootstrapState, "historical_backfill");
  });

  it("initCursor restores halt for permanent incidents but not retriable", async () => {
    const startSlot = FIXTURE_FOLLOWED_PROGRAMS[0]!.deploySlot;
    const writer = createMemorySvmRawWriter();
    await writer.upsertCursor({
      namespace: FIXTURE_NAMESPACE,
      lastContiguousSlot: FIXTURE_BLOCK.slot,
      bootstrapState: null,
      catchupIncident: "catchup_window_exceeded",
    });
    const loopPermanent = createIngestLoop({
      namespace: FIXTURE_NAMESPACE,
      startSlot,
      maxLagSlots: 2,
      followedPrograms: FIXTURE_FOLLOWED_PROGRAMS,
      writer,
      rpc: makeRpc({ head: FIXTURE_BLOCK.slot + 10 }),
    });
    await loopPermanent.initCursor();
    assert.equal(loopPermanent.getState().halted, true);
    assert.equal(loopPermanent.isReady(), false);

    const writer2 = createMemorySvmRawWriter();
    await writer2.upsertCursor({
      namespace: FIXTURE_NAMESPACE,
      lastContiguousSlot: FIXTURE_BLOCK.slot,
      bootstrapState: null,
      catchupIncident: "rpc_budget_exhausted",
    });
    const loopRetriable = createIngestLoop({
      namespace: FIXTURE_NAMESPACE,
      startSlot,
      maxLagSlots: 2,
      followedPrograms: FIXTURE_FOLLOWED_PROGRAMS,
      writer: writer2,
      rpc: makeRpc({
        head: FIXTURE_BLOCK.slot + 10,
        signaturesByProgram: {
          [FIXTURE_PASSPORT_PROGRAM]: [
            {
              signature: FIXTURE_BLOCK.transactions[0]!.signature,
              slot: FIXTURE_BLOCK.slot,
            },
          ],
        },
        blocks: { [FIXTURE_BLOCK.slot]: FIXTURE_BLOCK },
      }),
    });
    await loopRetriable.initCursor();
    assert.equal(loopRetriable.getState().halted, false);
    assert.equal(
      loopRetriable.getState().catchupIncident,
      "rpc_budget_exhausted",
    );
    await loopRetriable.followOnce();
    assert.equal(loopRetriable.getState().catchupIncident, null);
    assert.equal(loopRetriable.isReady(), true);
  });

  it("bootstrap discovery_incomplete retries to ready on later catchUpToHead", async () => {
    const startSlot = FIXTURE_FOLLOWED_PROGRAMS[0]!.deploySlot;
    let fail = true;
    const callCounts = {
      getBlock: 0,
      getSignaturesForAddress: 0,
      getSlot: 0,
      getFirstAvailableBlock: 0,
    };
    const rpc: SvmRpcClient = {
      callCounts,
      async getSlot() {
        callCounts.getSlot += 1;
        return FIXTURE_BLOCK.slot + 5;
      },
      async getFirstAvailableBlock() {
        callCounts.getFirstAvailableBlock += 1;
        return startSlot;
      },
      async getSignaturesForAddress(programId) {
        callCounts.getSignaturesForAddress += 1;
        if (fail) throw new Error("planted pagination failure");
        if (programId !== FIXTURE_PASSPORT_PROGRAM) return [];
        return [
          {
            signature: FIXTURE_BLOCK.transactions[0]!.signature,
            slot: FIXTURE_BLOCK.slot,
          },
        ];
      },
      async getBlock(slot) {
        callCounts.getBlock += 1;
        if (slot === FIXTURE_BLOCK.slot) return okBlock(FIXTURE_BLOCK);
        return missingBlock(slot);
      },
    };
    const writer = createMemorySvmRawWriter();
    const loop = createIngestLoop({
      namespace: FIXTURE_NAMESPACE,
      startSlot,
      maxLagSlots: 216_000,
      followedPrograms: FIXTURE_FOLLOWED_PROGRAMS,
      writer,
      rpc,
    });
    await loop.initCursor();
    await loop.catchUpToHead();
    assert.equal(loop.getState().bootstrapState, "historical_backfill");
    assert.equal(loop.getState().catchupIncident, "discovery_incomplete");
    assert.equal(loop.isReady(), false);

    fail = false;
    await loop.catchUpToHead();
    assert.equal(loop.getState().bootstrapState, null);
    assert.equal(loop.getState().catchupIncident, null);
    assert.equal(loop.isReady(), true);
  });

  it("getBlock rpc_budget_exhausted mid-list is retriable; watermark keeps processed slots", async () => {
    const startSlot = FIXTURE_FOLLOWED_PROGRAMS[0]!.deploySlot;
    const slotA = FIXTURE_BLOCK.slot;
    const slotB = slotA + 1;
    let blockCalls = 0;
    const rpc = makeRpc({
      head: slotB + 5,
      signaturesByProgram: {
        [FIXTURE_PASSPORT_PROGRAM]: [
          { signature: "sigA111111111111111111111111111111111111111111111111111", slot: slotA },
          { signature: "sigB222222222222222222222222222222222222222222222222222", slot: slotB },
        ],
      },
      getBlockImpl: async (slot) => {
        blockCalls += 1;
        if (slot === slotA) return okBlock(FIXTURE_BLOCK);
        throw new SvmIngestRpcBudgetExhaustedError(
          "Solana RPC rate limit exhausted after 6 attempts: planted getBlock",
        );
      },
    });
    const writer = createMemorySvmRawWriter();
    const loop = createIngestLoop({
      namespace: FIXTURE_NAMESPACE,
      startSlot,
      maxLagSlots: 216_000,
      followedPrograms: FIXTURE_FOLLOWED_PROGRAMS,
      writer,
      rpc,
    });
    await loop.initCursor();
    await loop.catchUpToHead();
    assert.equal(loop.getState().lastContiguousSlot, slotA);
    assert.equal(loop.getState().catchupIncident, "rpc_budget_exhausted");
    assert.equal(loop.getState().halted, false);
    assert.equal(loop.getState().bootstrapState, "historical_backfill");
    assert.ok(blockCalls >= 2);
  });
});

describe("discoverIngestSlots owner", () => {
  it("unions per-program floors and stops below deploySlot", async () => {
    const programs = [
      {
        slug: "kar-passport",
        programId: "ProgA",
        evidenceKey: "kar_passport",
        deploySlot: 100,
      },
      {
        slug: "kar-gateway",
        programId: "ProgB",
        evidenceKey: "kar_gateway",
        deploySlot: 200,
      },
    ] as const;
    const rpc = {
      async getSignaturesForAddress(programId: string) {
        if (programId === "ProgA") {
          return [
            { signature: "a2", slot: 150 },
            { signature: "a1", slot: 90 },
          ];
        }
        return [
          { signature: "b2", slot: 250 },
          { signature: "b1", slot: 180 },
        ];
      },
    };
    const result = await discoverIngestSlots({ programs, rpc });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.slots, [150, 250]);
  });

  it("live afterSlot stops at watermark — does not re-page to deploy floor", async () => {
    const programs = [
      {
        slug: "kar-passport",
        programId: "ProgA",
        evidenceKey: "kar_passport",
        deploySlot: 100,
      },
    ] as const;
    let pages = 0;
    const rpc = {
      async getSignaturesForAddress(
        _programId: string,
        opts?: { before?: string; limit?: number },
      ) {
        pages += 1;
        if (!opts?.before) {
          // Newest page: one new slot above watermark, then already-seen.
          return [
            { signature: "new", slot: 260 },
            { signature: "seen", slot: 250 },
          ];
        }
        // Would be history toward deploy floor — must not be requested.
        return [
          { signature: "old2", slot: 180 },
          { signature: "old1", slot: 90 },
        ];
      },
    };
    const result = await discoverIngestSlots({
      programs,
      rpc,
      afterSlot: 250,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.slots, [260]);
    assert.equal(pages, 1);
    assert.equal(result.signaturePages, 1);
  });

  it("live afterSlot pages through multiple new pages until watermark reached", async () => {
    const programs = [
      {
        slug: "kar-passport",
        programId: "ProgA",
        evidenceKey: "kar_passport",
        deploySlot: 100,
      },
    ] as const;
    let pages = 0;
    const rpc = {
      async getSignaturesForAddress(
        _programId: string,
        opts?: { before?: string; limit?: number },
      ) {
        pages += 1;
        if (!opts?.before) {
          return [
            { signature: "n3", slot: 280 },
            { signature: "n2", slot: 270 },
          ];
        }
        if (opts.before === "n2") {
          return [
            { signature: "n1", slot: 260 },
            { signature: "seen", slot: 250 },
          ];
        }
        return [{ signature: "old", slot: 90 }];
      },
    };
    const result = await discoverIngestSlots({
      programs,
      rpc,
      afterSlot: 250,
      pageLimit: 2,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.slots, [260, 270, 280]);
    assert.equal(pages, 2);
  });
});

describe("catchup incident vocabulary", () => {
  it("retriable vs permanent is bidirectional with the enumerator", () => {
    for (const id of RETRIABLE_CATCHUP_INCIDENTS) {
      assert.equal(isRetriableCatchupIncident(id), true);
    }
    assert.equal(isRetriableCatchupIncident("catchup_window_exceeded"), false);
    assert.equal(
      isRetriableCatchupIncident("startup_retention_unavailable"),
      false,
    );
    assert.equal(isRetriableCatchupIncident("sequence_gap"), false);
    assert.equal(isRetriableCatchupIncident(null), false);
  });
});
