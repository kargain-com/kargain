/**
 * Pure raw structured_payload → SVM provenance + custody projection rows (S7c-2 / S7c-3).
 */

import { originNamespaceOf } from "@/lib/custody/origin.js";
import type { CustodyDeterminationKind } from "@/lib/custody/normalized-event.js";
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

export type CustodyDeterminingProjectionDraft = {
  id: string;
  tokenId: string;
  chainId: number;
  kind: CustodyDeterminationKind;
  blockNumber: number;
  logIndex: number;
};

export type ProjectionBatch = {
  passportRecords: PassportRecordProjectionDraft[];
  uriHistory: PassportUriHistoryProjectionDraft[];
  custodyEvents: CustodyDeterminingProjectionDraft[];
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

const PROVENANCE_EVENTS = new Set(["RecordAppended", "PassportURIUpdated"]);
const CUSTODY_EVENTS = new Set([
  "PassportMinted",
  "PassportBridgeMinted",
  "CustodyLockSet",
  "VerificationReset",
]);

function fieldU8(fields: DecodedEventPayload["fields"], name: string): number {
  const f = fields.find((x) => x.name === name);
  return typeof f?.value === "number" ? f.value : 0;
}

function projectCustodyEvent(
  raw: RawPayloadForProjection,
  decoded: DecodedEventPayload,
): CustodyDeterminingProjectionDraft | null {
  const tokenId = tokenIdFromBytes32(fieldBytes32(decoded.fields, "tokenId"));
  let kind: CustodyDeterminationKind | null = null;

  switch (raw.eventName) {
    case "PassportMinted":
      kind = "native_mint";
      break;
    case "PassportBridgeMinted":
      kind = "bridge_arrival";
      break;
    case "CustodyLockSet":
      if (fieldU8(decoded.fields, "locked") !== 0) return null;
      kind = "custody_unlock";
      break;
    case "VerificationReset":
      if (raw.namespace !== originNamespaceOf(tokenId)) return null;
      kind = "home_unlock";
      break;
    default:
      return null;
  }

  return {
    id: raw.id,
    tokenId,
    chainId: raw.namespace,
    kind,
    blockNumber: raw.slot,
    logIndex: raw.logIndex,
  };
}

export function projectStructuredPayload(
  raw: RawPayloadForProjection,
  state: ProjectionReplayState,
): ProjectionBatch | null {
  if (raw.contractName !== "KarPassport") return null;
  if (!PROVENANCE_EVENTS.has(raw.eventName) && !CUSTODY_EVENTS.has(raw.eventName)) {
    return null;
  }

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

  const emptyBatch = (): ProjectionBatch => ({
    passportRecords: [],
    uriHistory: [],
    custodyEvents: [],
  });

  if (raw.eventName === "RecordAppended") {
    return {
      ...emptyBatch(),
      passportRecords: [projectRecordAppended(raw, decoded)],
    };
  }
  if (raw.eventName === "PassportURIUpdated") {
    return {
      ...emptyBatch(),
      uriHistory: [projectPassportUriUpdated(raw, decoded, state)],
    };
  }

  const custody = projectCustodyEvent(raw, decoded);
  if (!custody) return null;
  return { ...emptyBatch(), custodyEvents: [custody] };
}

export function projectStructuredPayloadsOrdered(
  rows: readonly RawPayloadForProjection[],
): ProjectionBatch {
  const state = emptyProjectionReplayState();
  const passportRecords: PassportRecordProjectionDraft[] = [];
  const uriHistory: PassportUriHistoryProjectionDraft[] = [];
  const custodyEvents: CustodyDeterminingProjectionDraft[] = [];

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
    custodyEvents.push(...batch.custodyEvents);
  }

  return { passportRecords, uriHistory, custodyEvents };
}
