/**
 * Pure raw structured_payload → SVM provenance + custody + entity projection (S7c-2 / S7c-3 / S7c-4).
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
import {
  emptyEntityProjectionReplayState,
  finalizeEntityProjectionState,
  loadMetadataSnapshotsIntoState,
  projectEntityFromPayload,
  type PassportEntityProjectionDraft,
} from "./passport-entity-projection.js";
import {
  type RawPayloadForProjection,
  provenanceTimestampFromSlot,
  sortRawPayloadsOrdered,
} from "./projection-common.js";
import type { MetadataSnapshotRow } from "./raw-replay-digest.js";

export type { PassportEntityProjectionDraft } from "./passport-entity-projection.js";
export type { RawPayloadForProjection } from "./projection-common.js";
export { provenanceTimestampFromSlot } from "./projection-common.js";

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
  passports: PassportEntityProjectionDraft[];
};

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

function emptyBatch(): ProjectionBatch {
  return {
    passportRecords: [],
    uriHistory: [],
    custodyEvents: [],
    passports: [],
  };
}

export function projectStructuredPayload(
  raw: RawPayloadForProjection,
  state: ProjectionReplayState,
  entityState?: ReturnType<typeof emptyEntityProjectionReplayState>,
): ProjectionBatch | null {
  let decoded: DecodedEventPayload | null = null;
  const needsDecode =
    raw.contractName === "KarPassport" &&
    (PROVENANCE_EVENTS.has(raw.eventName) ||
      CUSTODY_EVENTS.has(raw.eventName) ||
      entityState != null);

  if (needsDecode) {
    try {
      decoded = decodeEventPayloadBody({
        contractName: raw.contractName,
        eventName: raw.eventName,
        payloadBytes: raw.payloadBytes,
      });
    } catch {
      decoded = null;
    }
  }

  const batch = emptyBatch();

  if (decoded && raw.contractName === "KarPassport") {
    if (raw.eventName === "RecordAppended") {
      batch.passportRecords.push(projectRecordAppended(raw, decoded));
    } else if (raw.eventName === "PassportURIUpdated") {
      batch.uriHistory.push(projectPassportUriUpdated(raw, decoded, state));
    } else if (CUSTODY_EVENTS.has(raw.eventName)) {
      const custody = projectCustodyEvent(raw, decoded);
      if (custody) batch.custodyEvents.push(custody);
    }

    if (entityState) {
      const entity = projectEntityFromPayload(raw, decoded, entityState);
      if (entity) batch.passports.push(entity);
    }
  }

  if (
    batch.passportRecords.length === 0 &&
    batch.uriHistory.length === 0 &&
    batch.custodyEvents.length === 0 &&
    batch.passports.length === 0
  ) {
    return null;
  }
  return batch;
}

export function projectStructuredPayloadsOrdered(
  rows: readonly RawPayloadForProjection[],
  metadataSnapshots: readonly MetadataSnapshotRow[] = [],
): ProjectionBatch {
  const state = emptyProjectionReplayState();
  const entityState = emptyEntityProjectionReplayState();
  loadMetadataSnapshotsIntoState(metadataSnapshots, entityState);

  const passportRecords: PassportRecordProjectionDraft[] = [];
  const uriHistory: PassportUriHistoryProjectionDraft[] = [];
  const custodyEvents: CustodyDeterminingProjectionDraft[] = [];

  for (const raw of sortRawPayloadsOrdered(rows)) {
    const batch = projectStructuredPayload(raw, state, entityState);
    if (!batch) continue;
    passportRecords.push(...batch.passportRecords);
    uriHistory.push(...batch.uriHistory);
    custodyEvents.push(...batch.custodyEvents);
  }

  const passports = finalizeEntityProjectionState(entityState);

  return { passportRecords, uriHistory, custodyEvents, passports };
}
