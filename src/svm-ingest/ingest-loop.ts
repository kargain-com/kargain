/**
 * Slot follower — bounded catch-up, four named refusals, sole writer via svm-raw-writer.
 */

import type { FollowedProgram } from "../../lib/svm/ingest-config.js";
import { ingestRefusalRowId } from "../../lib/svm/ingest-refusal.js";
import { parseTransactionForIngest } from "../../lib/svm/parse-transaction-ingest.js";
import type { SvmRawWriter } from "../lib/svm-raw-writer.js";
import type { ProjectionProjector } from "./projection-projector.js";
import type { SvmRpcClient } from "./rpc-client.js";

export type IngestLoopState = {
  namespace: number;
  lastContiguousSlot: number;
  catchupIncident: string | null;
  lagSlots: number;
};

export type IngestLoopOptions = {
  namespace: number;
  startSlot: number;
  maxLagSlots: number;
  followedPrograms: readonly FollowedProgram[];
  writer: SvmRawWriter;
  rpc: SvmRpcClient;
  projector?: ProjectionProjector;
};

export function createIngestLoop(opts: IngestLoopOptions) {
  let halted = false;
  let state: IngestLoopState = {
    namespace: opts.namespace,
    lastContiguousSlot: opts.startSlot - 1,
    catchupIncident: null,
    lagSlots: 0,
  };

  async function initCursor(): Promise<void> {
    const existing = await opts.writer.getCursor(opts.namespace);
    if (existing) {
      state.lastContiguousSlot = existing.lastContiguousSlot;
      state.catchupIncident = existing.catchupIncident;
      return;
    }
    await opts.writer.upsertCursor({
      namespace: opts.namespace,
      lastContiguousSlot: opts.startSlot - 1,
      catchupIncident: null,
    });
    state.lastContiguousSlot = opts.startSlot - 1;
  }

  async function checkCatchupWindow(headSlot: number): Promise<boolean> {
    const lag = headSlot - state.lastContiguousSlot;
    state.lagSlots = lag;
    if (lag <= opts.maxLagSlots) return true;

    state.catchupIncident = "catchup_window_exceeded";
    halted = true;
    const detailKey = `lag:${lag}:max:${opts.maxLagSlots}`;
    await opts.writer.insertIngestRefusal({
      id: ingestRefusalRowId({
        namespace: opts.namespace,
        refusalKind: "sequence_gap",
        slot: headSlot,
        txSignature: null,
        logIndex: null,
        detailKey,
      }),
      namespace: opts.namespace,
      refusalKind: "sequence_gap",
      slot: headSlot,
      txIndexInBlock: null,
      logIndex: null,
      txSignature: null,
      emittingProgram: null,
      discriminator: null,
      detail: {
        incident: "catchup_window_exceeded",
        lagSlots: lag,
        maxLagSlots: opts.maxLagSlots,
        lastContiguousSlot: state.lastContiguousSlot,
      },
    });
    await opts.writer.upsertCursor({
      namespace: opts.namespace,
      lastContiguousSlot: state.lastContiguousSlot,
      catchupIncident: state.catchupIncident,
    });
    return false;
  }

  async function ingestSlot(slot: number): Promise<void> {
    const block = await opts.rpc.getBlock(slot);
    if (!block) {
      const detailKey = `missing_block:${slot}`;
      await opts.writer.insertIngestRefusal({
        id: ingestRefusalRowId({
          namespace: opts.namespace,
          refusalKind: "sequence_gap",
          slot,
          txSignature: null,
          logIndex: null,
          detailKey,
        }),
        namespace: opts.namespace,
        refusalKind: "sequence_gap",
        slot,
        txIndexInBlock: null,
        logIndex: null,
        txSignature: null,
        emittingProgram: null,
        discriminator: null,
        detail: { reason: "block_unavailable", slot },
      });
      state.catchupIncident = "sequence_gap";
      halted = true;
      await opts.writer.upsertCursor({
        namespace: opts.namespace,
        lastContiguousSlot: state.lastContiguousSlot,
        catchupIncident: state.catchupIncident,
      });
      return;
    }

    for (let txIndex = 0; txIndex < block.transactions.length; txIndex++) {
      const tx = block.transactions[txIndex]!;
      const parsed = parseTransactionForIngest({
        namespace: opts.namespace,
        slot,
        txIndexInBlock: txIndex,
        txSignature: tx.signature,
        logMessages: tx.logMessages,
        metaErr: tx.metaErr,
        followedPrograms: opts.followedPrograms,
      });
      await opts.writer.insertStructuredPayloads(parsed.payloads);
      await opts.writer.insertIngestRefusals(parsed.refusals);
      if (opts.projector && parsed.payloads.length > 0) {
        await opts.projector.projectPayloads(parsed.payloads);
      }
    }

    state.lastContiguousSlot = slot;
    state.catchupIncident = null;
    await opts.writer.upsertCursor({
      namespace: opts.namespace,
      lastContiguousSlot: slot,
      catchupIncident: null,
    });
  }

  async function catchUpToHead(): Promise<void> {
    const head = await opts.rpc.getSlot();
    if (!(await checkCatchupWindow(head))) return;

    let next = state.lastContiguousSlot + 1;
    while (next <= head && !halted) {
      await ingestSlot(next);
      next = state.lastContiguousSlot + 1;
    }
    state.lagSlots = head - state.lastContiguousSlot;
  }

  async function followOnce(): Promise<void> {
    if (halted) return;
    const head = await opts.rpc.getSlot();
    if (!(await checkCatchupWindow(head))) return;
    const next = state.lastContiguousSlot + 1;
    if (next <= head) {
      await ingestSlot(next);
    }
    state.lagSlots = head - state.lastContiguousSlot;
  }

  return {
    initCursor,
    catchUpToHead,
    followOnce,
    getState: () => ({ ...state, halted }),
    isReady: () => !halted && state.catchupIncident == null,
  };
}

/** Process a prefetched block without RPC — for replay tests. */
export async function ingestBlockFromFixture(args: {
  namespace: number;
  block: { slot: number; transactions: Array<{
    signature: string;
    metaErr: unknown;
    logMessages: string[] | null;
  }> };
  followedPrograms: readonly FollowedProgram[];
  writer: SvmRawWriter;
  projector?: ProjectionProjector;
  lastContiguousSlot: number;
}): Promise<number> {
  const { block, writer, namespace, followedPrograms } = args;
  for (let txIndex = 0; txIndex < block.transactions.length; txIndex++) {
    const tx = block.transactions[txIndex]!;
    const parsed = parseTransactionForIngest({
      namespace,
      slot: block.slot,
      txIndexInBlock: txIndex,
      txSignature: tx.signature,
      logMessages: tx.logMessages,
      metaErr: tx.metaErr,
      followedPrograms,
    });
    await writer.insertStructuredPayloads(parsed.payloads);
    await writer.insertIngestRefusals(parsed.refusals);
    if (args.projector && parsed.payloads.length > 0) {
      await args.projector.projectPayloads(parsed.payloads);
    }
  }
  await writer.upsertCursor({
    namespace,
    lastContiguousSlot: block.slot,
    catchupIncident: null,
  });
  return block.slot;
}
