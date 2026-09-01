/**
 * Append-only stream B writer for custody_determining_event (S7c-3).
 */

import { custodyDeterminingEvent } from "ponder:schema";

import type { CustodyDeterminationKind } from "../../lib/custody/normalized-event.js";

export type CustodyEventInsertContext = {
  db: {
    insert: (table: typeof custodyDeterminingEvent) => {
      values: (row: Record<string, unknown>) => Promise<unknown>;
    };
  };
};

export async function insertCustodyDeterminingEvent(
  context: CustodyEventInsertContext,
  params: {
    id: string;
    tokenId: string;
    chainId: number;
    kind: CustodyDeterminationKind;
    blockNumber: number;
    logIndex: number;
    txHash: string;
    timestamp: bigint;
  },
): Promise<void> {
  await context.db.insert(custodyDeterminingEvent).values({
    id: params.id,
    tokenId: params.tokenId,
    chainId: params.chainId,
    kind: params.kind,
    blockNumber: params.blockNumber,
    logIndex: params.logIndex,
    txHash: params.txHash.toLowerCase(),
    timestamp: params.timestamp,
  });
}
