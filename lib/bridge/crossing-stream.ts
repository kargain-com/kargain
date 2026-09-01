/**
 * Pure bridge-crossing helpers (no Ponder imports — safe for Node policy tests).
 */

export type BridgeCrossingDirection = "sent" | "received";

export type PassportCounterpartEventName =
  | "PassportBridgeMinted"
  | "CustodyLockSet";

export type PassportCounterpartCandidate = {
  eventName: PassportCounterpartEventName;
  tokenId: string;
  logIndex: number;
};

export type PassportCounterpartRefusal = "absent" | "ambiguous";

export function bridgeCrossingId(params: {
  observingChainId: number;
  txHash: string;
  logIndex: number;
}): string {
  return `${params.observingChainId}-${params.txHash.toLowerCase()}-${params.logIndex}`;
}

export function peerLayerZeroEidForDirection(
  direction: BridgeCrossingDirection,
  args: { dstEid: number; srcEid: number },
): number {
  return direction === "sent" ? args.dstEid : args.srcEid;
}

export function correlatePassportCounterpart(params: {
  tokenId: string;
  candidates: readonly PassportCounterpartCandidate[];
}):
  | {
      status: "linked";
      eventName: PassportCounterpartEventName;
      logIndex: number;
    }
  | { status: PassportCounterpartRefusal } {
  const matches = params.candidates.filter((c) => c.tokenId === params.tokenId);
  if (matches.length === 0) return { status: "absent" };
  if (matches.length > 1) return { status: "ambiguous" };
  return {
    status: "linked",
    eventName: matches[0].eventName,
    logIndex: matches[0].logIndex,
  };
}
