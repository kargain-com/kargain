/**
 * Signature-discovery ingest loop — slots from getSignaturesForAddress,
 * getBlock only for discovered slots (real tx_index_in_block).
 * Cursor `lastContiguousSlot` = high-water processed discovered slot.
 */

import { metadataSnapshotsForPayloads } from "../../lib/svm/ingest-metadata-capture.js";
import type { MetadataFetcher } from "../../lib/svm/capture-metadata-at-ingest.js";
import type { FollowedProgram } from "../../lib/svm/ingest-config.js";
import {
  ingestRefusalRowId,
  isRetriableCatchupIncident,
  type BootstrapCatchupState,
  type CatchupIncident,
} from "../../lib/svm/ingest-refusal.js";
import { discoverIngestSlots, type DiscoverIngestSlotsOk } from "../../lib/svm/ingest-slot-discovery.js";
import { parseTransactionForIngest } from "../../lib/svm/parse-transaction-ingest.js";
import {
  evaluateStartupRetention,
  startupRetentionUnavailableMessage,
} from "../../lib/svm/startup-retention.js";
import type { SvmRawWriter } from "../lib/svm-raw-writer.js";
import type { ProjectionProjector } from "./projection-projector.js";
import {
  SvmIngestRpcBudgetExhaustedError,
  type FetchedBlock,
  type SvmRpcClient,
} from "./rpc-client.js";

export type IngestLoopState = {
  namespace: number;
  /** High-water processed discovered slot (SQL column last_contiguous_slot). */
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
  /** Test-only injectable slot discovery (defaults to discoverIngestSlots owner). */
  discoverSlots?: typeof discoverIngestSlots;
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
      // Permanent incidents stay halted across restart; retriable recover on next tick.
      if (
        existing.catchupIncident &&
        !isRetriableCatchupIncident(existing.catchupIncident)
      ) {
        halted = true;
      }
      return;
    }
    await persistCursor();
    state.lastContiguousSlot = opts.startSlot - 1;
  }

  async function recordIncident(
    incident: CatchupIncident,
    detail: Record<string, unknown>,
    slot: number | null,
  ): Promise<void> {
    state.catchupIncident = incident;
    if (!isRetriableCatchupIncident(incident)) {
      halted = true;
    }
    const detailKey = `${incident}:${JSON.stringify(detail)}`.slice(0, 200);
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
      detail: { incident, ...detail },
    });
    await persistCursor();
  }

  async function clearRetriableIncident(): Promise<void> {
    if (!isRetriableCatchupIncident(state.catchupIncident)) return;
    state.catchupIncident = null;
    await persistCursor();
  }

  async function assertStartupRetention(headSlot: number): Promise<void> {
    const firstAvailableBlock = await opts.rpc.getFirstAvailableBlock();
    const result = evaluateStartupRetention({
      requiredSlot: opts.startSlot,
      firstAvailableBlock,
      headSlot,
    });
    if (result.ok) return;

    await recordIncident(
      result.incident,
      result.detail,
      result.detail.requiredSlot,
    );
    throw new Error(startupRetentionUnavailableMessage(result.detail));
  }

  async function ingestFetchedBlock(block: FetchedBlock): Promise<void> {
    for (let txIndex = 0; txIndex < block.transactions.length; txIndex++) {
      const tx = block.transactions[txIndex]!;
      const parsed = parseTransactionForIngest({
        namespace: opts.namespace,
        slot: block.slot,
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
  }

  /**
   * Process one discovered slot. Missing block → named refusal + advance watermark.
   */
  async function ingestDiscoveredSlot(slot: number): Promise<void> {
    const outcome = await opts.rpc.getBlock(slot);
    if (outcome.status === "missing_block") {
      await opts.writer.insertIngestRefusal({
        id: ingestRefusalRowId({
          namespace: opts.namespace,
          refusalKind: "sequence_gap",
          slot,
          txSignature: null,
          logIndex: null,
          detailKey: `discovered_slot_missing:${slot}`,
        }),
        namespace: opts.namespace,
        refusalKind: "sequence_gap",
        slot,
        txIndexInBlock: null,
        logIndex: null,
        txSignature: null,
        emittingProgram: null,
        discriminator: null,
        detail: {
          reason: "discovered_slot_missing_block",
          slot,
        },
      });
      state.lastContiguousSlot = slot;
      state.catchupIncident = null;
      await persistCursor();
      return;
    }

    await ingestFetchedBlock(outcome.block);
    state.lastContiguousSlot = slot;
    state.catchupIncident = null;
    await persistCursor();
  }

  function pendingSlotsBeyondWindow(
    slots: readonly number[],
    headSlot: number,
  ): number | null {
    const pending = slots.filter((s) => s > state.lastContiguousSlot);
    if (pending.length === 0) return null;
    const oldest = pending[0]!;
    if (oldest < headSlot - opts.maxLagSlots) return oldest;
    return null;
  }

  async function discoverOrIncident(args: {
    afterSlot?: number;
  }): Promise<DiscoverIngestSlotsOk | null> {
    const discover = opts.discoverSlots ?? discoverIngestSlots;
    try {
      const result = await discover({
        programs: opts.followedPrograms,
        rpc: opts.rpc,
        afterSlot: args.afterSlot,
      });
      if (!result.ok) {
        await recordIncident(
          "discovery_incomplete",
          {
            cause: result.cause,
            ...result.detail,
          },
          null,
        );
        return null;
      }
      return result;
    } catch (err) {
      if (err instanceof SvmIngestRpcBudgetExhaustedError) {
        await recordIncident(
          "rpc_budget_exhausted",
          { message: err.message },
          null,
        );
        return null;
      }
      throw err;
    }
  }

  async function refuseBootstrapRangeNotEnumerated(
    discovery: DiscoverIngestSlotsOk,
  ): Promise<void> {
    await recordIncident(
      "bootstrap_range_not_enumerated",
      {
        reason: "bootstrap_floors_not_reached",
        reachedEveryProgramFloor: discovery.reachedEveryProgramFloor,
        programFloors: discovery.programFloors,
      },
      null,
    );
  }

  async function processSlotList(
    slots: readonly number[],
    headSlot: number,
  ): Promise<boolean> {
    if (!state.bootstrapState) {
      const oldestBeyond = pendingSlotsBeyondWindow(slots, headSlot);
      if (oldestBeyond !== null) {
        await recordIncident(
          "catchup_window_exceeded",
          {
            lagSlots: headSlot - oldestBeyond,
            maxLagSlots: opts.maxLagSlots,
            oldestUnprocessedDiscoveredSlot: oldestBeyond,
            lastContiguousSlot: state.lastContiguousSlot,
            headSlot,
          },
          oldestBeyond,
        );
        state.lagSlots = headSlot - oldestBeyond;
        return false;
      }
    }

    const firstAvailable = await opts.rpc.getFirstAvailableBlock();
    for (const slot of slots) {
      if (halted) return false;
      if (slot < firstAvailable) {
        await recordIncident(
          "startup_retention_unavailable",
          {
            reason: "discovered_slot_before_first_available_block",
            requiredSlot: slot,
            firstAvailableBlock: firstAvailable,
            headSlot,
          },
          slot,
        );
        return false;
      }
      if (slot <= state.lastContiguousSlot) continue;
      try {
        await ingestDiscoveredSlot(slot);
      } catch (err) {
        if (err instanceof SvmIngestRpcBudgetExhaustedError) {
          await recordIncident(
            "rpc_budget_exhausted",
            { message: err.message, slot },
            slot,
          );
          return false;
        }
        throw err;
      }
    }
    return !halted;
  }

  /**
   * Bootstrap: page all programs to floors, getBlock discovered slots,
   * verify re-poll empty of extras. Clear historical_backfill only when discovery
   * reports every program floor enumerated (positive fact — never emptiness alone).
   * Empty + floors: watermark may advance to observed head. Floors absent: named
   * incident, flag stays, watermark unchanged.
   */
  async function catchUpToHead(): Promise<void> {
    halted = false;
    if (
      state.catchupIncident === "startup_retention_unavailable" ||
      isRetriableCatchupIncident(state.catchupIncident)
    ) {
      state.catchupIncident = null;
    }

    const head = await opts.rpc.getSlot();
    await assertStartupRetention(head);

    const primary = await discoverOrIncident({ afterSlot: undefined });
    if (primary === null) {
      state.lagSlots = head - state.lastContiguousSlot;
      return;
    }
    if (state.bootstrapState && !primary.reachedEveryProgramFloor) {
      await refuseBootstrapRangeNotEnumerated(primary);
      state.lagSlots = head - state.lastContiguousSlot;
      return;
    }

    const slots = primary.slots;
    const ok = await processSlotList(slots, head);
    if (!ok) {
      state.lagSlots = head - state.lastContiguousSlot;
      return;
    }

    // Verification re-poll — must not silently complete if new slots appeared.
    const verify = await discoverOrIncident({ afterSlot: undefined });
    if (verify === null) {
      state.lagSlots = head - state.lastContiguousSlot;
      return;
    }
    if (state.bootstrapState && !verify.reachedEveryProgramFloor) {
      await refuseBootstrapRangeNotEnumerated(verify);
      state.lagSlots = head - state.lastContiguousSlot;
      return;
    }
    const extras = verify.slots.filter((s) => s > state.lastContiguousSlot);
    if (extras.length > 0) {
      const okExtras = await processSlotList(extras, head);
      if (!okExtras) {
        state.lagSlots = head - state.lastContiguousSlot;
        return;
      }
      const again = await discoverOrIncident({ afterSlot: undefined });
      if (again === null) {
        state.lagSlots = head - state.lastContiguousSlot;
        return;
      }
      if (state.bootstrapState && !again.reachedEveryProgramFloor) {
        await refuseBootstrapRangeNotEnumerated(again);
        state.lagSlots = head - state.lastContiguousSlot;
        return;
      }
      const still = again.slots.filter((s) => s > state.lastContiguousSlot);
      if (still.length > 0) {
        await recordIncident(
          "discovery_incomplete",
          {
            reason: "verification_repoll_still_has_unprocessed_slots",
            unprocessed: still.slice(0, 16),
          },
          still[0] ?? null,
        );
        state.lagSlots = head - state.lastContiguousSlot;
        return;
      }
    }

    if (state.bootstrapState) {
      if (state.lastContiguousSlot < opts.startSlot - 1) {
        state.lastContiguousSlot = opts.startSlot - 1;
      }
      // Watermark → head only under the same positive fact (floors already checked).
      if (slots.length === 0 && extras.length === 0) {
        state.lastContiguousSlot = Math.max(state.lastContiguousSlot, head);
      }
      state.bootstrapState = null;
    }
    state.catchupIncident = null;
    await persistCursor();
    state.lagSlots = 0;
  }

  /**
   * Live follow: same discovery path — slots strictly above watermark.
   */
  async function followOnce(): Promise<void> {
    if (halted) return;
    if (state.bootstrapState) return;

    const head = await opts.rpc.getSlot();
    const discovered = await discoverOrIncident({
      afterSlot: state.lastContiguousSlot,
    });
    if (discovered === null) {
      state.lagSlots = head - state.lastContiguousSlot;
      return;
    }

    await clearRetriableIncident();

    const pending = discovered.slots.filter((s) => s > state.lastContiguousSlot);
    state.lagSlots =
      pending.length > 0 ? head - pending[0]! : 0;

    await processSlotList(pending, head);
    if (!halted && pending.length === 0) {
      state.lagSlots = 0;
    }
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
  block: {
    slot: number;
    transactions: Array<{
      signature: string;
      metaErr: unknown;
      logMessages: string[] | null;
    }>;
  };
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
