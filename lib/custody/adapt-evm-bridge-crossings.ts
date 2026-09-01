import type { NormalizedCrossingLeg } from "./normalized-event.js";
import { evmWriterOrderKey } from "./writer-order.js";

export type EvmBridgeCrossingRow = {
  guid: string;
  direction: string;
  tokenId: string;
  observingChainId: number;
  peerNamespace: number | null;
  peerNamespaceRefusal: string | null;
  blockNumber: number;
  logIndex: number;
};

export function adaptEvmBridgeCrossingRow(row: EvmBridgeCrossingRow): NormalizedCrossingLeg | null {
  if (row.direction !== "sent" && row.direction !== "received") return null;
  return {
    guid: row.guid.toLowerCase(),
    direction: row.direction,
    tokenId: row.tokenId,
    observerNamespace: row.observingChainId,
    peerNamespace: row.peerNamespace,
    peerNamespaceRefusal:
      row.peerNamespaceRefusal === "unknown_endpoint_id"
        ? "unknown_endpoint_id"
        : undefined,
    writerOrderKey: evmWriterOrderKey(
      row.observingChainId,
      row.blockNumber,
      row.logIndex,
    ),
  };
}

export function adaptEvmBridgeCrossingRows(
  rows: readonly EvmBridgeCrossingRow[],
): NormalizedCrossingLeg[] {
  const out: NormalizedCrossingLeg[] = [];
  for (const row of rows) {
    const adapted = adaptEvmBridgeCrossingRow(row);
    if (adapted) out.push(adapted);
  }
  return out;
}
