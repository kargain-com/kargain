import type { CustodyDeterminationKind, NormalizedCustodyEvent } from "./normalized-event.js";
import { evmWriterOrderKey } from "./writer-order.js";

export type EvmCustodyDeterminingRow = {
  tokenId: string;
  chainId: number;
  kind: string;
  blockNumber: number;
  logIndex: number;
};

const KIND_MAP: Record<string, CustodyDeterminationKind> = {
  native_mint: "native_mint",
  bridge_arrival: "bridge_arrival",
  custody_unlock: "custody_unlock",
  home_unlock: "home_unlock",
};

export function adaptEvmCustodyDeterminingRow(
  row: EvmCustodyDeterminingRow,
): NormalizedCustodyEvent | null {
  const kind = KIND_MAP[row.kind];
  if (!kind) return null;
  return {
    tokenId: row.tokenId,
    namespace: row.chainId,
    kind,
    writerOrderKey: evmWriterOrderKey(row.chainId, row.blockNumber, row.logIndex),
  };
}

export function adaptEvmCustodyDeterminingRows(
  rows: readonly EvmCustodyDeterminingRow[],
): NormalizedCustodyEvent[] {
  const out: NormalizedCustodyEvent[] = [];
  for (const row of rows) {
    const adapted = adaptEvmCustodyDeterminingRow(row);
    if (adapted) out.push(adapted);
  }
  return out;
}
