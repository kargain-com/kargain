/**
 * Shared projection types/helpers (S7c-2 / S7c-4).
 */

import type { StructuredPayloadDraft } from "./parse-transaction-ingest.js";

export type RawPayloadForProjection = Pick<
  StructuredPayloadDraft,
  | "id"
  | "namespace"
  | "slot"
  | "txIndexInBlock"
  | "logIndex"
  | "contractName"
  | "eventName"
  | "payloadBytes"
>;

/** Slot-ordered monotonic bigint used as provenance timestamp (D-05 clocks incomparable cross-VM). */
export function provenanceTimestampFromSlot(slot: number): bigint {
  return BigInt(slot);
}

export function sortRawPayloadsOrdered(
  rows: readonly RawPayloadForProjection[],
): RawPayloadForProjection[] {
  return [...rows].sort((a, b) => {
    if (a.namespace !== b.namespace) return a.namespace - b.namespace;
    if (a.slot !== b.slot) return a.slot - b.slot;
    if (a.txIndexInBlock !== b.txIndexInBlock) {
      return a.txIndexInBlock - b.txIndexInBlock;
    }
    return a.logIndex - b.logIndex;
  });
}
