/**
 * Pure passport entity projection from raw payloads + metadata snapshots (S7c-4).
 */

import { originNamespaceOf } from "@/lib/custody/origin.js";
import { isDisputeWithdrawnRecord } from "@/lib/passport/index-passport-metadata";
import { encodeSvmPubkeyBytes } from "@/lib/web3/protocol-address";

import {
  bridgeMintArrivalTrustFields,
  disputeExpiredTrustFields,
  disputeOutcomeUpholdsVerification,
  disputeResolvedTrustFields,
  disputeWithdrawnTrustFields,
  passportDisputedTrustFields,
  passportMintTrustFields,
  passportUriUpdatedTrustFields,
  verificationResetTrustFields,
} from "../../src/lib/ponder-g1-fields.js";
import { denormFromMetadataSnapshotRow } from "./metadata-snapshot.js";
import type { MetadataSnapshotRow } from "./raw-replay-digest.js";
import {
  decodeEventPayloadBody,
  fieldBytes32,
  fieldPubkey32,
  fieldString,
  fieldU64,
  fieldU8,
  tokenIdFromBytes32,
  type DecodedEventPayload,
} from "./event-payload-decode.js";
import type { RawPayloadForProjection } from "./projection-common.js";
import { provenanceTimestampFromSlot, sortRawPayloadsOrdered } from "./projection-common.js";

export type PassportEntityProjectionDraft = {
  id: string;
  chainId: number;
  owner: string;
  status: string;
  verifier: string;
  verifiedAt: bigint;
  tokenUri: string;
  coverPhotoUri: string;
  vin: string;
  make: string;
  model: string;
  year: number;
  mileageKm: number;
  lastDisputer: string;
  disputeReason: string;
  disputeWithdrawnAt: bigint;
  lastVerificationResetAt: bigint;
  duplicateVin: boolean;
  lastMetadataChangeAt: bigint;
  verificationResetCount: number;
  hadDispute: boolean;
  lastDisputeResolvedAt: bigint;
  lastDisputeTerminal: string;
  disputeOpenedAt: bigint;
  fuelType: string;
  bodyType: string;
  transmission: string;
  condition: string;
  vehicleType: string;
  colour: string;
  locationLabel: string;
  locationPlaceId: string;
  locationCountryCode: string;
  disputeDeposit: bigint | null;
  createdAt: bigint;
  updatedAt: bigint;
};

export type EntityProjectionReplayState = {
  entities: Map<string, PassportEntityProjectionDraft>;
  uriByToken: Map<string, string>;
  /** Latest captured denorm per URI from raw snapshots. */
  denormByUri: Map<string, NonNullable<ReturnType<typeof denormFromMetadataSnapshotRow>>>;
};

export function emptyEntityProjectionReplayState(): EntityProjectionReplayState {
  return { entities: new Map(), uriByToken: new Map(), denormByUri: new Map() };
}

function uriStateKey(namespace: number, tokenId: string): string {
  return `${namespace}:${tokenId}`;
}

function isZeroPubkey(bytes: Uint8Array): boolean {
  for (const b of bytes) {
    if (b !== 0) return false;
  }
  return true;
}

function emptyEntityDefaults(
  tokenId: string,
  namespace: number,
  ts: bigint,
): PassportEntityProjectionDraft {
  return {
    id: tokenId,
    chainId: originNamespaceOf(tokenId),
    owner: "",
    status: "UNVERIFIED",
    verifier: "",
    verifiedAt: 0n,
    tokenUri: "",
    coverPhotoUri: "",
    vin: "",
    make: "",
    model: "",
    year: 0,
    mileageKm: 0,
    lastDisputer: "",
    disputeReason: "",
    disputeWithdrawnAt: 0n,
    lastVerificationResetAt: 0n,
    duplicateVin: false,
    lastMetadataChangeAt: 0n,
    verificationResetCount: 0,
    hadDispute: false,
    lastDisputeResolvedAt: 0n,
    lastDisputeTerminal: "",
    disputeOpenedAt: 0n,
    fuelType: "",
    bodyType: "",
    transmission: "",
    condition: "",
    vehicleType: "",
    colour: "",
    locationLabel: "",
    locationPlaceId: "",
    locationCountryCode: "",
    disputeDeposit: null,
    createdAt: ts,
    updatedAt: ts,
  };
}

function getOrCreateEntity(
  state: EntityProjectionReplayState,
  tokenId: string,
  namespace: number,
  ts: bigint,
): PassportEntityProjectionDraft {
  let row = state.entities.get(tokenId);
  if (!row) {
    row = emptyEntityDefaults(tokenId, namespace, ts);
    state.entities.set(tokenId, row);
  }
  return row;
}

function applyMetadataDenorm(
  row: PassportEntityProjectionDraft,
  uri: string,
  state: EntityProjectionReplayState,
): void {
  const denorm = state.denormByUri.get(uri);
  if (!denorm) return;
  row.vin = denorm.vin;
  row.make = denorm.make;
  row.model = denorm.model;
  row.year = denorm.year;
  row.mileageKm = denorm.mileageKm;
  row.fuelType = denorm.fuelType;
  row.bodyType = denorm.bodyType;
  row.transmission = denorm.transmission;
  row.condition = denorm.condition;
  row.vehicleType = denorm.vehicleType;
  row.colour = denorm.colour;
  row.locationLabel = denorm.locationLabel;
  row.locationPlaceId = denorm.locationPlaceId;
  row.locationCountryCode = denorm.locationCountryCode;
  row.coverPhotoUri = denorm.coverPhotoUri;
}

function applyUriToEntity(
  row: PassportEntityProjectionDraft,
  uri: string,
  namespace: number,
  tokenId: string,
  ts: bigint,
  state: EntityProjectionReplayState,
): void {
  row.tokenUri = uri;
  state.uriByToken.set(uriStateKey(namespace, tokenId), uri);
  Object.assign(row, passportUriUpdatedTrustFields(ts));
  applyMetadataDenorm(row, uri, state);
}

export function loadMetadataSnapshotsIntoState(
  snapshots: readonly MetadataSnapshotRow[],
  state: EntityProjectionReplayState,
): void {
  for (const snap of snapshots) {
    if (snap.status !== "captured") continue;
    const denorm = denormFromMetadataSnapshotRow(snap);
    if (!denorm) continue;
    state.denormByUri.set(snap.uri, denorm);
  }
}

const ENTITY_EVENTS = new Set([
  "PassportMinted",
  "PassportBridgeMinted",
  "Transfer",
  "PassportVerified",
  "PassportDisputed",
  "ChallengeOpened",
  "ChallengeJudged",
  "ChallengeConcluded",
  "ChallengeWithdrawn",
  "VerificationReset",
  "PassportURIUpdated",
  "RecordAppended",
]);

export function projectEntityFromPayload(
  raw: RawPayloadForProjection,
  decoded: DecodedEventPayload,
  state: EntityProjectionReplayState,
): PassportEntityProjectionDraft | null {
  if (raw.contractName !== "KarPassport") return null;
  if (!ENTITY_EVENTS.has(raw.eventName)) return null;

  const ts = provenanceTimestampFromSlot(raw.slot);

  switch (raw.eventName) {
    case "PassportMinted": {
      const tokenId = tokenIdFromBytes32(fieldBytes32(decoded.fields, "tokenId"));
      const owner = encodeSvmPubkeyBytes(fieldPubkey32(decoded.fields, "to"));
      const uri = fieldString(decoded.fields, "uri");
      const row = emptyEntityDefaults(tokenId, raw.namespace, ts);
      row.owner = owner;
      Object.assign(row, passportMintTrustFields(ts));
      applyUriToEntity(row, uri, raw.namespace, tokenId, ts, state);
      state.entities.set(tokenId, row);
      return row;
    }
    case "PassportBridgeMinted": {
      const tokenId = tokenIdFromBytes32(fieldBytes32(decoded.fields, "tokenId"));
      const owner = encodeSvmPubkeyBytes(fieldPubkey32(decoded.fields, "to"));
      const uri = fieldString(decoded.fields, "uri");
      const existing = state.entities.get(tokenId);
      const row = existing ?? emptyEntityDefaults(tokenId, raw.namespace, ts);
      row.owner = owner;
      if (existing) {
        Object.assign(row, bridgeMintArrivalTrustFields(ts));
      } else {
        Object.assign(row, passportMintTrustFields(ts));
      }
      applyUriToEntity(row, uri, raw.namespace, tokenId, ts, state);
      state.entities.set(tokenId, row);
      return row;
    }
    case "Transfer": {
      const from = fieldPubkey32(decoded.fields, "from");
      if (isZeroPubkey(from)) return null;
      const tokenId = tokenIdFromBytes32(fieldBytes32(decoded.fields, "tokenId"));
      const row = getOrCreateEntity(state, tokenId, raw.namespace, ts);
      row.owner = encodeSvmPubkeyBytes(fieldPubkey32(decoded.fields, "to"));
      row.updatedAt = ts;
      return row;
    }
    case "PassportVerified": {
      const tokenId = tokenIdFromBytes32(fieldBytes32(decoded.fields, "tokenId"));
      const row = getOrCreateEntity(state, tokenId, raw.namespace, ts);
      row.status = "VERIFIED";
      row.verifier = encodeSvmPubkeyBytes(fieldPubkey32(decoded.fields, "verifier"));
      row.verifiedAt = ts;
      row.updatedAt = ts;
      return row;
    }
    case "PassportDisputed": {
      const tokenId = tokenIdFromBytes32(fieldBytes32(decoded.fields, "tokenId"));
      const row = getOrCreateEntity(state, tokenId, raw.namespace, ts);
      row.lastDisputer = encodeSvmPubkeyBytes(fieldPubkey32(decoded.fields, "disputer"));
      row.disputeReason = "";
      Object.assign(row, passportDisputedTrustFields(ts));
      return row;
    }
    case "ChallengeOpened": {
      const tokenId = tokenIdFromBytes32(fieldBytes32(decoded.fields, "subjectId"));
      const row = getOrCreateEntity(state, tokenId, raw.namespace, ts);
      row.disputeDeposit = fieldU64(decoded.fields, "bondAmount");
      row.updatedAt = ts;
      return row;
    }
    case "ChallengeJudged": {
      const tokenId = tokenIdFromBytes32(fieldBytes32(decoded.fields, "subjectId"));
      const row = getOrCreateEntity(state, tokenId, raw.namespace, ts);
      const outcome = fieldU8(decoded.fields, "outcome");
      const uphold = disputeOutcomeUpholdsVerification(outcome);
      Object.assign(
        row,
        disputeResolvedTrustFields(uphold, ts, uphold ? "reject" : "confirm"),
      );
      return row;
    }
    case "ChallengeConcluded": {
      const tokenId = tokenIdFromBytes32(fieldBytes32(decoded.fields, "subjectId"));
      const row = getOrCreateEntity(state, tokenId, raw.namespace, ts);
      Object.assign(row, disputeExpiredTrustFields(ts));
      return row;
    }
    case "ChallengeWithdrawn": {
      const tokenId = tokenIdFromBytes32(fieldBytes32(decoded.fields, "subjectId"));
      const row = getOrCreateEntity(state, tokenId, raw.namespace, ts);
      Object.assign(row, disputeWithdrawnTrustFields(ts));
      return row;
    }
    case "VerificationReset": {
      const tokenId = tokenIdFromBytes32(fieldBytes32(decoded.fields, "tokenId"));
      const row = getOrCreateEntity(state, tokenId, raw.namespace, ts);
      Object.assign(
        row,
        verificationResetTrustFields(row.verificationResetCount, ts),
      );
      return row;
    }
    case "PassportURIUpdated": {
      const tokenId = tokenIdFromBytes32(fieldBytes32(decoded.fields, "tokenId"));
      const uri = fieldString(decoded.fields, "newURI");
      const row = getOrCreateEntity(state, tokenId, raw.namespace, ts);
      const verificationReset =
        row.lastVerificationResetAt === ts && row.lastVerificationResetAt > 0n;
      applyUriToEntity(row, uri, raw.namespace, tokenId, ts, state);
      if (verificationReset) {
        row.lastVerificationResetAt = ts;
      }
      return row;
    }
    case "RecordAppended": {
      const tokenId = tokenIdFromBytes32(fieldBytes32(decoded.fields, "tokenId"));
      const row = getOrCreateEntity(state, tokenId, raw.namespace, ts);
      const author = encodeSvmPubkeyBytes(fieldPubkey32(decoded.fields, "author"));
      const recordType = fieldString(decoded.fields, "recordType");
      const description = fieldString(decoded.fields, "description");
      if (
        isDisputeWithdrawnRecord(
          recordType,
          description,
          author,
          row.lastDisputer,
        )
      ) {
        row.disputeWithdrawnAt = ts;
        row.disputeOpenedAt = 0n;
        row.disputeDeposit = null;
        row.updatedAt = ts;
      }
      return row;
    }
    default:
      return null;
  }
}

export function recomputeSvmDuplicateVin(
  entities: Map<string, PassportEntityProjectionDraft>,
): void {
  const byVin = new Map<string, string[]>();
  for (const [id, row] of entities) {
    if (!row.vin) continue;
    const list = byVin.get(row.vin) ?? [];
    list.push(id);
    byVin.set(row.vin, list);
  }
  for (const row of entities.values()) {
    if (!row.vin) {
      row.duplicateVin = false;
      continue;
    }
    row.duplicateVin = (byVin.get(row.vin)?.length ?? 0) > 1;
  }
}

export function finalizeEntityProjectionState(
  state: EntityProjectionReplayState,
): PassportEntityProjectionDraft[] {
  recomputeSvmDuplicateVin(state.entities);
  return [...state.entities.values()];
}
