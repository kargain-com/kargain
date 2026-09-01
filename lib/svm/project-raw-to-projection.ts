/**
 * Pure raw structured_payload → SVM provenance projection rows (S7c-2).
 * KarPassport RecordAppended + PassportURIUpdated only; D-38/D-39 skipped.
 */

import { encodeSvmPubkeyBytes } from "@/lib/web3/protocol-address";

import {
  decodeEventPayloadBody,
  fieldBytes32,
  fieldPubkey32,
  fieldString,
  tokenIdFromBytes32,
  type DecodedEventPayload,
} from "./event-payload-decode.js";
import type { StructuredPayloadDraft } from "./parse-transaction-ingest.js";

export type PassportRecordProjectionDraft = {
  id: string;
  tokenId: string;
  chainId: number;
  author: string;
  recordType: string;
  description: string;
  evidenceCID: string;
  timestamp: bigint;
};

export type PassportUriHistoryProjectionDraft = {
  id: string;
  tokenId: string;
  chainId: number;
  previousUri: string;
  newUri: string;
  author: string;
  verificationReset: boolean;
  timestamp: bigint;
};

export type ProjectionBatch = {
  passportRecords: PassportRecordProjectionDraft[];
  uriHistory: PassportUriHistoryProjectionDraft[];
};

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

export type ProjectionReplayState = {
  /** Last projected URI per (namespace, tokenId) for previousUri derivation. */
  uriByToken: Map<string, string>;
};

export function emptyProjectionReplayState(): ProjectionReplayState {
  return { uriByToken: new Map() };
}

function uriStateKey(namespace: number, tokenId: string): string {
  return `${namespace}:${tokenId}`;
}

/** Slot-ordered monotonic bigint used as provenance timestamp (D-05 clocks incomparable cross-VM). */
export function provenanceTimestampFromSlot(slot: number): bigint {
  return BigInt(slot);
}

function projectRecordAppended(
  raw: RawPayloadForProjection,
  decoded: DecodedEventPayload,
): PassportRecordProjectionDraft {
  const tokenId = tokenIdFromBytes32(fieldBytes32(decoded.fields, "tokenId"));
  const authorBytes = fieldPubkey32(decoded.fields, "author");
  return {
    id: raw.id,
    tokenId,
    chainId: raw.namespace,
    author: encodeSvmPubkeyBytes(authorBytes),
    recordType: fieldString(decoded.fields, "recordType"),
    description: fieldString(decoded.fields, "description"),
    evidenceCID: fieldString(decoded.fields, "evidenceCID"),
    timestamp: provenanceTimestampFromSlot(raw.slot),
  };
}

function projectPassportUriUpdated(
  raw: RawPayloadForProjection,
  decoded: DecodedEventPayload,
  state: ProjectionReplayState,
): PassportUriHistoryProjectionDraft {
  const tokenId = tokenIdFromBytes32(fieldBytes32(decoded.fields, "tokenId"));
  const newUri = fieldString(decoded.fields, "newURI");
  const authorBytes = fieldPubkey32(decoded.fields, "author");
  const key = uriStateKey(raw.namespace, tokenId);
  const previousUri = state.uriByToken.get(key) ?? "";
  state.uriByToken.set(key, newUri);
  return {
    id: raw.id,
    tokenId,
    chainId: raw.namespace,
    previousUri,
    newUri,
    author: encodeSvmPubkeyBytes(authorBytes),
    verificationReset: false,
    timestamp: provenanceTimestampFromSlot(raw.slot),
  };
}

const PROJECTABLE_EVENTS = new Set(["RecordAppended", "PassportURIUpdated"]);

export function projectStructuredPayload(
  raw: RawPayloadForProjection,
  state: ProjectionReplayState,
): ProjectionBatch | null {
  if (raw.contractName !== "KarPassport") return null;
  if (!PROJECTABLE_EVENTS.has(raw.eventName)) return null;

  let decoded: DecodedEventPayload;
  try {
    decoded = decodeEventPayloadBody({
      contractName: raw.contractName,
      eventName: raw.eventName,
      payloadBytes: raw.payloadBytes,
    });
  } catch {
    return null;
  }

  if (raw.eventName === "RecordAppended") {
    return {
      passportRecords: [projectRecordAppended(raw, decoded)],
      uriHistory: [],
    };
  }
  if (raw.eventName === "PassportURIUpdated") {
    return {
      passportRecords: [],
      uriHistory: [projectPassportUriUpdated(raw, decoded, state)],
    };
  }
  return null;
}

export function projectStructuredPayloadsOrdered(
  rows: readonly RawPayloadForProjection[],
): ProjectionBatch {
  const state = emptyProjectionReplayState();
  const passportRecords: PassportRecordProjectionDraft[] = [];
  const uriHistory: PassportUriHistoryProjectionDraft[] = [];

  const sorted = [...rows].sort((a, b) => {
    if (a.namespace !== b.namespace) return a.namespace - b.namespace;
    if (a.slot !== b.slot) return a.slot - b.slot;
    if (a.txIndexInBlock !== b.txIndexInBlock) {
      return a.txIndexInBlock - b.txIndexInBlock;
    }
    return a.logIndex - b.logIndex;
  });

  for (const raw of sorted) {
    const batch = projectStructuredPayload(raw, state);
    if (!batch) continue;
    passportRecords.push(...batch.passportRecords);
    uriHistory.push(...batch.uriHistory);
  }

  return { passportRecords, uriHistory };
}
