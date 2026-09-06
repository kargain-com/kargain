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

export type DiscoverIngestSlotsOk = {
  ok: true;
  /** Ascending unique slots to fetch. */
  slots: number[];
  signaturePages: number;
  signatureRows: number;
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
 * Incomplete mid-page RPC failure → ok:false (must not claim complete).
 */
export async function discoverIngestSlots(
  args: DiscoverIngestSlotsArgs,
): Promise<DiscoverIngestSlotsResult> {
  const pageLimit = args.pageLimit ?? DEFAULT_PAGE_LIMIT;
  const afterSlot =
    typeof args.afterSlot === "number" ? args.afterSlot : Number.NEGATIVE_INFINITY;
  const slotSet = new Set<number>();
  let signaturePages = 0;
  let signatureRows = 0;

  for (const program of args.programs) {
    let before: string | undefined;
    let reachedFloor = false;
    while (!reachedFloor) {
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
        reachedFloor = true;
        break;
      }

      for (const row of page) {
        if (row.slot < program.deploySlot) {
          reachedFloor = true;
          continue;
        }
        if (row.slot > afterSlot) {
          slotSet.add(row.slot);
        }
      }

      const oldestOnPage = page[page.length - 1]!;
      if (oldestOnPage.slot < program.deploySlot) {
        reachedFloor = true;
      }
      if (page.length < pageLimit) {
        reachedFloor = true;
      }
      before = oldestOnPage.signature;
    }
  }

  return {
    ok: true,
    slots: [...slotSet].sort((a, b) => a - b),
    signaturePages,
    signatureRows,
  };
}
