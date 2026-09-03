/**
 * Bridge-crossing DB writer for `bridge_crossing` (S7b).
 * Pure helpers live in lib/bridge/crossing-stream.ts.
 */

import { bridgeCrossing } from "ponder:schema";
import { and, eq } from "ponder";
import { getAddress } from "viem";

import {
  bridgeCrossingId,
  correlatePassportCounterpart,
  type PassportCounterpartEventName,
  type PassportCounterpartRefusal,
} from "../../lib/bridge/crossing-stream";
import {
  commercialNamespaceFromLayerZeroEid,
  type PeerNamespaceRefusalReason,
} from "../../lib/web3/commercial-eid-namespace";
import type { IndexingContext } from "./ponder-optional-contract-on";

type Hash = `0x${string}`;

export type {
  BridgeCrossingDirection,
  PassportCounterpartCandidate,
  PassportCounterpartEventName,
  PassportCounterpartRefusal,
} from "../../lib/bridge/crossing-stream";

export {
  bridgeCrossingId,
  correlatePassportCounterpart,
  peerLayerZeroEidForDirection,
} from "../../lib/bridge/crossing-stream";

/** Indexing context — structural IndexingContext (not EventNames-tied). */
export type BridgeCrossingContext = IndexingContext;


type PendingBridgeTxState = {
  passportCandidates: Array<{
    eventName: PassportCounterpartEventName;
    tokenId: string;
    logIndex: number;
  }>;
};

const MAX_PENDING_TX_ENTRIES = 2000;
const pendingBridgeTx = new Map<string, PendingBridgeTxState>();

function txKey(txHash: string): string {
  return txHash.toLowerCase();
}

function getPendingState(txHash: string): PendingBridgeTxState {
  const key = txKey(txHash);
  let state = pendingBridgeTx.get(key);
  if (!state) {
    state = { passportCandidates: [] };
    pendingBridgeTx.set(key, state);
    if (pendingBridgeTx.size > MAX_PENDING_TX_ENTRIES) {
      const oldestKey = pendingBridgeTx.keys().next().value;
      if (oldestKey !== undefined) pendingBridgeTx.delete(oldestKey);
    }
  }
  return state;
}

function resolvePeerNamespace(peerEid: number): {
  peerNamespace: number | null;
  peerNamespaceRefusal: PeerNamespaceRefusalReason | null;
} {
  const resolved = commercialNamespaceFromLayerZeroEid(peerEid);
  if (resolved.ok) {
    return {
      peerNamespace: Number(resolved.namespace),
      peerNamespaceRefusal: null,
    };
  }
  return {
    peerNamespace: null,
    peerNamespaceRefusal: resolved.reason,
  };
}

function correlationFieldsForReceived(params: {
  tokenId: string;
  txHash: string;
}):
  | {
      passportCounterpartEvent: PassportCounterpartEventName;
      passportCounterpartLogIndex: number;
      passportCounterpartRefusal: null;
    }
  | {
      passportCounterpartEvent: null;
      passportCounterpartLogIndex: null;
      passportCounterpartRefusal: PassportCounterpartRefusal;
    } {
  const candidates = getPendingState(params.txHash).passportCandidates;
  const correlated = correlatePassportCounterpart({
    tokenId: params.tokenId,
    candidates,
  });
  if (correlated.status === "linked") {
    return {
      passportCounterpartEvent: correlated.eventName,
      passportCounterpartLogIndex: correlated.logIndex,
      passportCounterpartRefusal: null,
    };
  }
  return {
    passportCounterpartEvent: null,
    passportCounterpartLogIndex: null,
    passportCounterpartRefusal: correlated.status,
  };
}

async function backfillReceivedCrossings(
  context: BridgeCrossingContext,
  txHash: string,
  tokenId: string,
): Promise<void> {
  const rows = await context.db.sql
    .select()
    .from(bridgeCrossing)
    .where(
      and(
        eq(bridgeCrossing.txHash, txKey(txHash)),
        eq(bridgeCrossing.direction, "received"),
        eq(bridgeCrossing.tokenId, tokenId),
        eq(bridgeCrossing.passportCounterpartRefusal, "absent"),
      ),
    );

  const candidates = getPendingState(txHash).passportCandidates;
  const correlated = correlatePassportCounterpart({ tokenId, candidates });

  for (const row of rows) {
    if (correlated.status === "linked") {
      await context.db
        .update(bridgeCrossing, { id: row.id })
        .set({
          passportCounterpartEvent: correlated.eventName,
          passportCounterpartLogIndex: correlated.logIndex,
          passportCounterpartRefusal: null,
        });
    } else if (correlated.status === "ambiguous") {
      await context.db
        .update(bridgeCrossing, { id: row.id })
        .set({
          passportCounterpartEvent: null,
          passportCounterpartLogIndex: null,
          passportCounterpartRefusal: "ambiguous",
        });
    }
  }
}

export async function notePassportCounterpartForTx(
  context: BridgeCrossingContext,
  params: {
    txHash: Hash;
    tokenId: string;
    logIndex: number;
    eventName: PassportCounterpartEventName;
  },
): Promise<void> {
  const state = getPendingState(params.txHash);
  state.passportCandidates.push({
    eventName: params.eventName,
    tokenId: params.tokenId,
    logIndex: params.logIndex,
  });
  await backfillReceivedCrossings(context, params.txHash, params.tokenId);
}

type OnftCrossingCommon = {
  observingChainId: number;
  guid: Hash;
  tokenId: string;
  blockNumber: number;
  logIndex: number;
  txHash: Hash;
  timestamp: bigint;
};

export async function insertOnftSentCrossing(
  context: BridgeCrossingContext,
  params: OnftCrossingCommon & {
    dstEid: number;
    fromAddress: string;
  },
): Promise<void> {
  const peerEid = params.dstEid;
  const peer = resolvePeerNamespace(peerEid);
  await context.db.insert(bridgeCrossing).values({
    id: bridgeCrossingId({
      observingChainId: params.observingChainId,
      txHash: params.txHash,
      logIndex: params.logIndex,
    }),
    guid: params.guid.toLowerCase(),
    direction: "sent",
    observingChainId: params.observingChainId,
    peerLayerZeroEid: peerEid,
    peerNamespace: peer.peerNamespace,
    peerNamespaceRefusal: peer.peerNamespaceRefusal,
    tokenId: params.tokenId,
    party: getAddress(params.fromAddress as `0x${string}`),
    blockNumber: params.blockNumber,
    logIndex: params.logIndex,
    txHash: txKey(params.txHash),
    timestamp: params.timestamp,
    passportCounterpartEvent: null,
    passportCounterpartLogIndex: null,
    passportCounterpartRefusal: null,
  });
}

export async function insertOnftReceivedCrossing(
  context: BridgeCrossingContext,
  params: OnftCrossingCommon & {
    srcEid: number;
    toAddress: string;
  },
): Promise<void> {
  const peerEid = params.srcEid;
  const peer = resolvePeerNamespace(peerEid);
  const correlation = correlationFieldsForReceived({
    tokenId: params.tokenId,
    txHash: params.txHash,
  });
  await context.db.insert(bridgeCrossing).values({
    id: bridgeCrossingId({
      observingChainId: params.observingChainId,
      txHash: params.txHash,
      logIndex: params.logIndex,
    }),
    guid: params.guid.toLowerCase(),
    direction: "received",
    observingChainId: params.observingChainId,
    peerLayerZeroEid: peerEid,
    peerNamespace: peer.peerNamespace,
    peerNamespaceRefusal: peer.peerNamespaceRefusal,
    tokenId: params.tokenId,
    party: getAddress(params.toAddress as `0x${string}`),
    blockNumber: params.blockNumber,
    logIndex: params.logIndex,
    txHash: txKey(params.txHash),
    timestamp: params.timestamp,
    passportCounterpartEvent: correlation.passportCounterpartEvent,
    passportCounterpartLogIndex: correlation.passportCounterpartLogIndex,
    passportCounterpartRefusal: correlation.passportCounterpartRefusal,
  });
}
