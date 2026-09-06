/**
 * Slot follower — bounded catch-up, four named refusals, sole writer via svm-raw-writer.
 */

import { metadataSnapshotsForPayloads } from "../../lib/svm/ingest-metadata-capture.js";
import type { MetadataFetcher } from "../../lib/svm/capture-metadata-at-ingest.js";
import type { FollowedProgram } from "../../lib/svm/ingest-config.js";
import {
  ingestRefusalRowId,
  type BootstrapCatchupState,
  type CatchupIncident,
} from "../../lib/svm/ingest-refusal.js";
import { parseTransactionForIngest } from "../../lib/svm/parse-transaction-ingest.js";
import type { SvmRawWriter } from "../lib/svm-raw-writer.js";
import type { ProjectionProjector } from "./projection-projector.js";
import type { SvmRpcClient } from "./rpc-client.js";

export type IngestLoopState = {
  namespace: number;
  lastContiguousSlot: number;
  bootstrapState: BootstrapCatchupState | null;
  catchupIncident: CatchupIncident | null;
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
  /** Test-only injectable metadata fetcher for inline capture. */
  metadataFetcher?: MetadataFetcher;
};

export function createIngestLoop(opts: IngestLoopOptions) {
  let halted = false;
  let state: IngestLoopState = {
    namespace: opts.namespace,
    lastContiguousSlot: opts.startSlot - 1,
    bootstrapState: "historical_backfill",
    catchupIncident: null,
    lagSlots: 0,
  };

  function nextRequiredSlot(): number {
    return state.lastContiguousSlot + 1;
  }

  async function persistCursor(): Promise<void> {
    await opts.writer.upsertCursor({
      namespace: opts.namespace,
      lastContiguousSlot: state.lastContiguousSlot,
      bootstrapState: state.bootstrapState,
      catchupIncident: state.catchupIncident,
    });
  }

  async function initCursor(): Promise<void> {
    const existing = await opts.writer.getCursor(opts.namespace);
    if (existing) {
      state.lastContiguousSlot = existing.lastContiguousSlot;
      state.bootstrapState = existing.bootstrapState;
      state.catchupIncident = existing.catchupIncident;
      return;
    }
    await persistCursor();
    state.lastContiguousSlot = opts.startSlot - 1;
  }

  async function checkCatchupWindow(headSlot: number): Promise<boolean> {
    if (state.bootstrapState) {
      state.lagSlots = headSlot - state.lastContiguousSlot;
      return true;
    }
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
    await persistCursor();
    return false;
  }

  async function assertStartupRetention(headSlot: number): Promise<void> {
    const requiredSlot = nextRequiredSlot();
    if (requiredSlot > headSlot) return;
    const firstAvailableBlock = await opts.rpc.getFirstAvailableBlock();
    if (requiredSlot >= firstAvailableBlock) return;

    state.catchupIncident = "startup_retention_unavailable";
    halted = true;
    const detailKey = `required:${requiredSlot}:first:${firstAvailableBlock}`;
    await opts.writer.insertIngestRefusal({
      id: ingestRefusalRowId({
        namespace: opts.namespace,
        refusalKind: "sequence_gap",
        slot: requiredSlot,
        txSignature: null,
        logIndex: null,
        detailKey,
      }),
      namespace: opts.namespace,
      refusalKind: "sequence_gap",
      slot: requiredSlot,
      txIndexInBlock: null,
      logIndex: null,
      txSignature: null,
      emittingProgram: null,
      discriminator: null,
      detail: {
        incident: "startup_retention_unavailable",
        reason: "required_slot_before_first_available_block",
        requiredSlot,
        firstAvailableBlock,
        headSlot,
      },
    });
    await persistCursor();
    throw new Error(
      `svm-ingest RPC retention unavailable: required slot ${requiredSlot} is before first available block ${firstAvailableBlock}`,
    );
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
      await persistCursor();
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
      const snapshots = await metadataSnapshotsForPayloads({
        payloads: parsed.payloads,
        fetcher: opts.metadataFetcher,
      });
      await opts.writer.insertMetadataSnapshots(snapshots);
      await opts.writer.insertIngestRefusals(parsed.refusals);
      if (opts.projector && parsed.payloads.length > 0) {
        await opts.projector.projectPayloads(parsed.payloads, snapshots);
      }
    }

    state.lastContiguousSlot = slot;
    state.catchupIncident = null;
    await persistCursor();
  }

  async function catchUpToHead(): Promise<void> {
    const head = await opts.rpc.getSlot();
    await assertStartupRetention(head);
    if (!(await checkCatchupWindow(head))) return;

    let next = nextRequiredSlot();
    while (next <= head && !halted) {
      await ingestSlot(next);
      next = nextRequiredSlot();
    }
    if (!halted && state.bootstrapState && state.lastContiguousSlot >= head) {
      state.bootstrapState = null;
      await persistCursor();
    }
    state.lagSlots = head - state.lastContiguousSlot;
  }

  async function followOnce(): Promise<void> {
    if (halted) return;
    const head = await opts.rpc.getSlot();
    if (!(await checkCatchupWindow(head))) return;
    const next = nextRequiredSlot();
    if (next <= head) {
      await ingestSlot(next);
    }
    state.lagSlots = head - state.lastContiguousSlot;
  }

  return {
    initCursor,
    assertStartupRetention,
    catchUpToHead,
    followOnce,
    getState: () => ({ ...state, halted }),
    isReady: () =>
      !halted && state.bootstrapState == null && state.catchupIncident == null,
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
  metadataFetcher?: MetadataFetcher;
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
    const snapshots = await metadataSnapshotsForPayloads({
      payloads: parsed.payloads,
      fetcher: args.metadataFetcher,
    });
    await writer.insertMetadataSnapshots(snapshots);
    await writer.insertIngestRefusals(parsed.refusals);
    if (args.projector && parsed.payloads.length > 0) {
      await args.projector.projectPayloads(parsed.payloads, snapshots);
    }
  }
  await writer.upsertCursor({
    namespace,
    lastContiguousSlot: block.slot,
    bootstrapState: null,
    catchupIncident: null,
  });
  return block.slot;
}
