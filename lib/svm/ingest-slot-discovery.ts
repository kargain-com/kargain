/**
 * Sole owner: discover SVM ingest slots via getSignaturesForAddress.
 * Per-program floor from FollowedProgram.deploySlot; union of slots only.
 * Does not fetch blocks — ingest-loop does that for real tx indexes.
 */

import type { FollowedProgram } from "./ingest-config";

export type SignaturePageRow = {
  signature: string;
  slot: number;
};

export type SlotDiscoveryRpc = {
  getSignaturesForAddress: (
    programId: string,
    opts?: { before?: string; limit?: number },
  ) => Promise<SignaturePageRow[]>;
};

export type ProgramFloorReach = {
  evidenceKey: string;
  programId: string;
  /** True iff paging reached this program's deploySlot floor (not merely live watermark). */
  reachedFloor: boolean;
};

export type DiscoverIngestSlotsOk = {
  ok: true;
  /** Ascending unique slots to fetch. */
  slots: number[];
  signaturePages: number;
  signatureRows: number;
  /**
   * Positive fact: every program was enumerated to its deploy floor.
   * Live watermark early-exit alone does not count — bootstrap completion turns on this.
   */
  reachedEveryProgramFloor: boolean;
  programFloors: readonly ProgramFloorReach[];
};

export type DiscoverIngestSlotsFail = {
  ok: false;
  cause: "pagination_incomplete";
  detail: {
    programId: string;
    evidenceKey: string;
    message: string;
  };
};

export type DiscoverIngestSlotsResult =
  | DiscoverIngestSlotsOk
  | DiscoverIngestSlotsFail;

export type DiscoverIngestSlotsArgs = {
  programs: readonly FollowedProgram[];
  rpc: SlotDiscoveryRpc;
  /**
   * Live follow: only slots strictly greater than this watermark.
   * Bootstrap: omit (or pass undefined) to include every slot >= each program floor.
   */
  afterSlot?: number;
  pageLimit?: number;
};

const DEFAULT_PAGE_LIMIT = 1_000;

/**
 * Page each commercial program newest→oldest until below that program's deploySlot.
 * With `afterSlot` (live follow): stop as soon as the page reaches slots ≤ watermark —
 * do not re-walk history to the deploy floor on every poll.
 * Incomplete mid-page RPC failure → ok:false (must not claim complete).
 *
 * Ok.reachedEveryProgramFloor is true only when every program exited with deploy-floor
 * evidence (empty page, slot < deploySlot, or short page exhausting history) — not when
 * live follow stopped solely at the watermark.
 */
export async function discoverIngestSlots(
  args: DiscoverIngestSlotsArgs,
): Promise<DiscoverIngestSlotsResult> {
  const pageLimit = args.pageLimit ?? DEFAULT_PAGE_LIMIT;
  const afterSlot =
    typeof args.afterSlot === "number" ? args.afterSlot : Number.NEGATIVE_INFINITY;
  const liveFollow = Number.isFinite(afterSlot);
  const slotSet = new Set<number>();
  let signaturePages = 0;
  let signatureRows = 0;
  const programFloors: ProgramFloorReach[] = [];

  for (const program of args.programs) {
    let before: string | undefined;
    let reachedDeployFloor = false;
    let done = false;
    while (!done) {
      let page: SignaturePageRow[];
      try {
        page = await args.rpc.getSignaturesForAddress(program.programId, {
          before,
          limit: pageLimit,
        });
      } catch (err) {
        // Budget owner lives in rpc-client; rethrow so ingest-loop can name rpc_budget_exhausted.
        if (
          err instanceof Error &&
          err.name === "SvmIngestRpcBudgetExhaustedError"
        ) {
          throw err;
        }
        return {
          ok: false,
          cause: "pagination_incomplete",
          detail: {
            programId: program.programId,
            evidenceKey: program.evidenceKey,
            message: err instanceof Error ? err.message : String(err),
          },
        };
      }
      signaturePages += 1;
      signatureRows += page.length;

      if (page.length === 0) {
        reachedDeployFloor = true;
        done = true;
        break;
      }

      for (const row of page) {
        if (row.slot < program.deploySlot) {
          reachedDeployFloor = true;
          continue;
        }
        if (row.slot > afterSlot) {
          slotSet.add(row.slot);
        }
      }

      const oldestOnPage = page[page.length - 1]!;
      if (oldestOnPage.slot < program.deploySlot) {
        reachedDeployFloor = true;
        done = true;
      }
      // Short page → no further history; range enumerated (floor vacuously reached).
      if (page.length < pageLimit) {
        reachedDeployFloor = true;
        done = true;
      }
      // Live: stop at watermark without claiming deploy floor unless already evidenced.
      if (liveFollow && oldestOnPage.slot <= afterSlot) {
        done = true;
      }
      before = oldestOnPage.signature;
    }
    programFloors.push({
      evidenceKey: program.evidenceKey,
      programId: program.programId,
      reachedFloor: reachedDeployFloor,
    });
  }

  const reachedEveryProgramFloor = programFloors.every((p) => p.reachedFloor);

  return {
    ok: true,
    slots: [...slotSet].sort((a, b) => a - b),
    signaturePages,
    signatureRows,
    reachedEveryProgramFloor,
    programFloors,
  };
}
