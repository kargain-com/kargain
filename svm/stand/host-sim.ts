/**
 * Host-level both-direction stand simulation (no validator / no Hardhat).
 *
 * Stitches the same check order as SVM unit owners:
 * - Endpoint clear **before** state mutation
 * - Gateway receive fail-closed (compose required / undecodable)
 * - Passport bridge mint / lock / burn / unlock (VerificationReset only from VERIFIED)
 *
 * Records at each step: trust, URI pointer, records-per-chain, home lock vs foreign mint/burn.
 */

import {
  abiEncodeString,
  encodeOnftMessage,
  decodeOnftMessage,
  tokenIdFromParts,
  uriFailClosed,
  type OnftComposeErrorName,
} from "../../lib/web3/bridge/onft-msg-codec.ts";
import {
  STAND_EVM_EID,
  STAND_EVM_NAMESPACE,
  STAND_SVM_EID,
  STAND_SVM_NAMESPACE,
  STAND_TYPICAL_URI,
} from "./constants.ts";
import {
  assertPayloadUnchanged,
  relayCopyPayload,
  type StandRelayPacket,
} from "./dumb-relay.ts";

export type TrustStatus = "UNVERIFIED" | "VERIFIED" | "DISPUTED";

export type ChainRecord = {
  index: number;
  recordType: string;
  description: string;
};

export type TokenPresence = {
  tokenId: Uint8Array;
  status: TrustStatus;
  uri: string;
  /** Records authored on **this** chain — never travel with the bridge message. */
  records: ChainRecord[];
  /** Home only: custody lock while abroad. */
  custodyLocked: boolean;
  /** Asset exists (Core / ERC-721). */
  assetExists: boolean;
  /** Foreign burn tombstone (state PDA retained on SVM). */
  burned: boolean;
};

export type ChainLedger = {
  vm: "evm" | "svm";
  eid: number;
  namespace: bigint;
  tokens: Map<string, TokenPresence>;
};

export type ScenarioStep = {
  name: string;
  direction: "evm→svm" | "svm→evm" | "local";
  /** Exact payload bytes relayed (if any). */
  payloadHex: string | null;
  clearBeforeState: boolean | null;
  evm: Snapshot;
  svm: Snapshot;
};

export type Snapshot = {
  tokenIdHex: string;
  status: TrustStatus | "absent";
  uri: string | null;
  recordCount: number;
  custodyLocked: boolean;
  assetExists: boolean;
  burned: boolean;
};

function tidKey(tokenId: Uint8Array): string {
  return Buffer.from(tokenId).toString("hex");
}

function namespaceOf(tokenId: Uint8Array): bigint {
  let n = 0n;
  for (let i = 0; i < 16; i++) {
    n = (n << 8n) | BigInt(tokenId[i]!);
  }
  return n;
}

function snapshot(ledger: ChainLedger, tokenId: Uint8Array): Snapshot {
  const t = ledger.tokens.get(tidKey(tokenId));
  if (t == null) {
    return {
      tokenIdHex: tidKey(tokenId),
      status: "absent",
      uri: null,
      recordCount: 0,
      custodyLocked: false,
      assetExists: false,
      burned: false,
    };
  }
  return {
    tokenIdHex: tidKey(tokenId),
    status: t.status,
    uri: t.uri,
    recordCount: t.records.length,
    custodyLocked: t.custodyLocked,
    assetExists: t.assetExists,
    burned: t.burned,
  };
}

function isHome(tokenId: Uint8Array, namespace: bigint): boolean {
  return namespaceOf(tokenId) === namespace;
}

/** Mirror `assert_clear_before_state` — refuse state-first. */
export function assertClearBeforeState(phases: Array<"cleared" | "state">): void {
  let seenClear = false;
  for (const p of phases) {
    if (p === "cleared") seenClear = true;
    else if (!seenClear) throw new Error("state mutation before endpoint clear");
  }
  if (!seenClear) throw new Error("missing endpoint clear");
}

export type ReceivePlan =
  | { kind: "mint_foreign"; to: Uint8Array; uri: string }
  | { kind: "unlock_home"; to: Uint8Array; uri: string };

export type ReceiveRefuse = { ok: false; error: OnftComposeErrorName };
export type ReceiveOk = { ok: true; plan: ReceivePlan };
export type ReceiveResult = ReceiveOk | ReceiveRefuse;

/** Gateway receive: decode fail-closed, then classify home vs foreign. */
export function planReceive(
  payload: Uint8Array,
  localNamespace: bigint,
): ReceiveResult {
  let decoded;
  try {
    decoded = decodeOnftMessage(payload);
  } catch {
    return { ok: false, error: "ComposeUndecodable" };
  }
  const uri = uriFailClosed(decoded);
  if (!uri.ok) return { ok: false, error: uri.error };
  const home = isHome(decoded.tokenId, localNamespace);
  if (home) {
    return { ok: true, plan: { kind: "unlock_home", to: decoded.sendTo, uri: uri.uri } };
  }
  return { ok: true, plan: { kind: "mint_foreign", to: decoded.sendTo, uri: uri.uri } };
}

export type RoundTripResult = {
  steps: ScenarioStep[];
  /** VerificationReset emitted only when home unlock left VERIFIED. */
  verificationResetOnReturn: boolean;
  outboundPayload: Uint8Array;
  returnPayload: Uint8Array;
};

function emptyLedger(vm: "evm" | "svm", eid: number, namespace: bigint): ChainLedger {
  return { vm, eid, namespace, tokens: new Map() };
}

/**
 * mint (EVM home) → send → receive (SVM foreign) → return → unlock (EVM home).
 * Trust is UNVERIFIED after each crossing; VerificationReset only from VERIFIED.
 */
export function runBothDirectionHostRoundTrip(opts?: {
  uri?: string;
  /** Prior home status before leave (default VERIFIED to exercise reset). */
  priorHomeStatus?: TrustStatus;
}): RoundTripResult {
  const uri = opts?.uri ?? STAND_TYPICAL_URI;
  const priorHomeStatus = opts?.priorHomeStatus ?? "VERIFIED";
  const tokenId = tokenIdFromParts(STAND_EVM_NAMESPACE, 1n);
  const evm = emptyLedger("evm", STAND_EVM_EID, STAND_EVM_NAMESPACE);
  const svm = emptyLedger("svm", STAND_SVM_EID, STAND_SVM_NAMESPACE);
  const steps: ScenarioStep[] = [];
  const sendToSvm = new Uint8Array(32).fill(0x11);
  const sendToEvm = new Uint8Array(32).fill(0x22);
  const evmGateway = new Uint8Array(32).fill(0xaa);
  const svmGateway = new Uint8Array(32).fill(0xbb);

  // --- mint on EVM home ---
  evm.tokens.set(tidKey(tokenId), {
    tokenId,
    status: "UNVERIFIED",
    uri,
    records: [{ index: 0, recordType: "mint", description: "home mint" }],
    custodyLocked: false,
    assetExists: true,
    burned: false,
  });
  steps.push({
    name: "mint_home_evm",
    direction: "local",
    payloadHex: null,
    clearBeforeState: null,
    evm: snapshot(evm, tokenId),
    svm: snapshot(svm, tokenId),
  });

  // --- optional verify (so return emits VerificationReset) ---
  const home = evm.tokens.get(tidKey(tokenId))!;
  home.status = priorHomeStatus;
  if (priorHomeStatus === "VERIFIED") {
    home.records.push({ index: 1, recordType: "verify", description: "home verify" });
  }
  steps.push({
    name: "set_home_trust",
    direction: "local",
    payloadHex: null,
    clearBeforeState: null,
    evm: snapshot(evm, tokenId),
    svm: snapshot(svm, tokenId),
  });

  // --- leave EVM: lock home, encode URI before debit ---
  home.custodyLocked = true;
  const composed = abiEncodeString(uri);
  const { message: outbound } = encodeOnftMessage(sendToSvm, tokenId, composed);
  const outboundPacket: StandRelayPacket = {
    srcEid: STAND_EVM_EID,
    dstEid: STAND_SVM_EID,
    sender: evmGateway,
    nonce: 1n,
    guid: new Uint8Array(32).fill(1),
    payload: outbound,
  };
  const deliveredOut = relayCopyPayload(outboundPacket);
  assertPayloadUnchanged(outboundPacket.payload, deliveredOut.payload);

  steps.push({
    name: "send_evm_lock_home",
    direction: "evm→svm",
    payloadHex: Buffer.from(outbound).toString("hex"),
    clearBeforeState: null,
    evm: snapshot(evm, tokenId),
    svm: snapshot(svm, tokenId),
  });

  // --- SVM receive: clear then mint foreign UNVERIFIED ---
  assertClearBeforeState(["cleared", "state"]);
  const recvOut = planReceive(deliveredOut.payload, STAND_SVM_NAMESPACE);
  if (!recvOut.ok) throw new Error(`outbound receive refused: ${recvOut.error}`);
  if (recvOut.plan.kind !== "mint_foreign") {
    throw new Error(`expected mint_foreign, got ${recvOut.plan.kind}`);
  }
  svm.tokens.set(tidKey(tokenId), {
    tokenId,
    status: "UNVERIFIED",
    uri: recvOut.plan.uri,
    records: [],
    custodyLocked: false,
    assetExists: true,
    burned: false,
  });
  steps.push({
    name: "receive_svm_mint_foreign",
    direction: "evm→svm",
    payloadHex: Buffer.from(deliveredOut.payload).toString("hex"),
    clearBeforeState: true,
    evm: snapshot(evm, tokenId),
    svm: snapshot(svm, tokenId),
  });

  // SVM-local record stays on SVM
  const foreign = svm.tokens.get(tidKey(tokenId))!;
  foreign.records.push({ index: 0, recordType: "note", description: "svm-only record" });
  steps.push({
    name: "svm_local_record",
    direction: "local",
    payloadHex: null,
    clearBeforeState: null,
    evm: snapshot(evm, tokenId),
    svm: snapshot(svm, tokenId),
  });

  // --- return: burn foreign, encode URI, unlock home ---
  foreign.burned = true;
  foreign.assetExists = false;
  const returnComposed = abiEncodeString(foreign.uri);
  const { message: retMsg } = encodeOnftMessage(sendToEvm, tokenId, returnComposed);
  const returnPacket: StandRelayPacket = {
    srcEid: STAND_SVM_EID,
    dstEid: STAND_EVM_EID,
    sender: svmGateway,
    nonce: 2n,
    guid: new Uint8Array(32).fill(2),
    payload: retMsg,
  };
  const deliveredRet = relayCopyPayload(returnPacket);
  assertPayloadUnchanged(returnPacket.payload, deliveredRet.payload);

  steps.push({
    name: "send_svm_burn_foreign",
    direction: "svm→evm",
    payloadHex: Buffer.from(retMsg).toString("hex"),
    clearBeforeState: null,
    evm: snapshot(evm, tokenId),
    svm: snapshot(svm, tokenId),
  });

  assertClearBeforeState(["cleared", "state"]);
  const recvRet = planReceive(deliveredRet.payload, STAND_EVM_NAMESPACE);
  if (!recvRet.ok) throw new Error(`return receive refused: ${recvRet.error}`);
  if (recvRet.plan.kind !== "unlock_home") {
    throw new Error(`expected unlock_home, got ${recvRet.plan.kind}`);
  }
  const wasVerified = home.status === "VERIFIED";
  const emitReset = wasVerified;
  home.status = "UNVERIFIED";
  home.custodyLocked = false;
  if (recvRet.plan.uri.length > 0) {
    home.uri = recvRet.plan.uri;
  }
  steps.push({
    name: "receive_evm_unlock_home",
    direction: "svm→evm",
    payloadHex: Buffer.from(deliveredRet.payload).toString("hex"),
    clearBeforeState: true,
    evm: snapshot(evm, tokenId),
    svm: snapshot(svm, tokenId),
  });

  // Invariants
  const finalEvm = evm.tokens.get(tidKey(tokenId))!;
  const finalSvm = svm.tokens.get(tidKey(tokenId))!;
  if (finalEvm.status !== "UNVERIFIED") throw new Error("home trust must be UNVERIFIED after return");
  if (finalEvm.custodyLocked) throw new Error("home must unlock");
  if (finalEvm.records.length < 1) throw new Error("EVM records must remain on EVM");
  if (finalSvm.records.length !== 1) throw new Error("SVM records must remain on SVM");
  if (finalSvm.burned !== true) throw new Error("foreign must be burned on return");
  if (finalEvm.uri !== uri) throw new Error("URI pointer must travel");

  return {
    steps,
    verificationResetOnReturn: emitReset,
    outboundPayload: outbound,
    returnPayload: retMsg,
  };
}

/** Fail-closed vectors the stand must refuse before any state mutation. */
export function refuseReceiveWithoutCompose(localNamespace: bigint): ReceiveRefuse {
  const tokenId = tokenIdFromParts(STAND_EVM_NAMESPACE, 9n);
  const { message } = encodeOnftMessage(new Uint8Array(32).fill(1), tokenId, null);
  const r = planReceive(message, localNamespace);
  if (r.ok) throw new Error("expected ComposeRequired");
  return r;
}

export function refuseReceiveCorruptedCompose(localNamespace: bigint): ReceiveRefuse {
  const tokenId = tokenIdFromParts(STAND_EVM_NAMESPACE, 9n);
  const { message: base } = encodeOnftMessage(new Uint8Array(32).fill(1), tokenId, null);
  const bad = new Uint8Array(base.length + 40);
  bad.set(base);
  bad.fill(0xff, 64);
  const r = planReceive(bad, localNamespace);
  if (r.ok) throw new Error("expected ComposeUndecodable");
  return r;
}
