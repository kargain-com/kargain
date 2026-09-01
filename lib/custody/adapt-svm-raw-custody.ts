import type { NormalizedCustodyEvent, NormalizedCrossingLeg } from "./normalized-event.js";
import { svmWriterOrderKey } from "./writer-order.js";

export type SvmRawCustodyRow = {
  id: string;
  namespace: number;
  slot: number;
  txIndexInBlock: number;
  logIndex: number;
  tokenId: string;
  kind: NormalizedCustodyEvent["kind"];
};

export function adaptSvmRawCustodyRow(row: SvmRawCustodyRow): NormalizedCustodyEvent {
  return {
    tokenId: row.tokenId,
    namespace: row.namespace,
    kind: row.kind,
    writerOrderKey: svmWriterOrderKey(
      row.namespace,
      row.slot,
      row.txIndexInBlock,
      row.logIndex,
    ),
  };
}

export function adaptSvmRawCustodyRows(
  rows: readonly SvmRawCustodyRow[],
): NormalizedCustodyEvent[] {
  return rows.map(adaptSvmRawCustodyRow);
}

export type SvmRawCrossingRow = {
  guid: string;
  direction: "sent" | "received";
  tokenId: string;
  namespace: number;
  peerNamespace: number | null;
  peerNamespaceRefusal?: "unknown_endpoint_id";
  slot: number;
  txIndexInBlock: number;
  logIndex: number;
};

export function adaptSvmRawCrossingRow(row: SvmRawCrossingRow): NormalizedCrossingLeg {
  return {
    guid: row.guid.toLowerCase(),
    direction: row.direction,
    tokenId: row.tokenId,
    observerNamespace: row.namespace,
    peerNamespace: row.peerNamespace,
    peerNamespaceRefusal: row.peerNamespaceRefusal,
    writerOrderKey: svmWriterOrderKey(
      row.namespace,
      row.slot,
      row.txIndexInBlock,
      row.logIndex,
    ),
  };
}
