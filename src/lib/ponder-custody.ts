/**
 * Pure custody / records helpers for dual-chain Ponder (SPEC §I.12.8).
 *
 * Origin (`chainId`) is immutable `chainIdOf(tokenId)`.
 * `custodyChain` tracks where the usable instance lives.
 * Updates are monotonic on `custodyUpdatedAt` so a lagging spoke cannot
 * overwrite a fresher home unlock.
 */

/** Immutable origin — `tokenId >> 128` (SPEC §I.12.1). */
export function originChainIdOf(tokenId: bigint | string): number {
  const id = typeof tokenId === "bigint" ? tokenId : BigInt(tokenId);
  return Number(id >> 128n);
}

export type CustodyEvent =
  | { kind: "native-mint"; eventChainId: number; tokenId: bigint | string }
  | { kind: "bridge-mint"; eventChainId: number }
  | { kind: "custody-unlock"; eventChainId: number }
  | { kind: "verification-reset-home"; eventChainId: number; originChainId: number }
  | { kind: "bridge-burn" };

export type CustodyState = {
  custodyChain: number;
  custodyUpdatedAt: bigint;
};

/**
 * Next `custodyChain` after a bridge/mint/unlock event.
 * `PassportBridgeBurned` returns `undefined` — destination mint owns custody.
 */
export function nextCustodyChain(
  current: number | undefined,
  event: CustodyEvent,
): number | undefined {
  switch (event.kind) {
    case "native-mint":
      return originChainIdOf(event.tokenId);
    case "bridge-mint":
      return event.eventChainId;
    case "custody-unlock":
      return event.eventChainId;
    case "verification-reset-home":
      // Unlock on home emits VerificationReset; set custody to home (origin).
      return event.originChainId;
    case "bridge-burn":
      return undefined;
  }
}

/**
 * Monotonic custody gate: accept only if `eventTs >= existing.custodyUpdatedAt`.
 * Returns `null` when the candidate is stale (skip custody fields only).
 */
export function resolveCustody(
  existing: CustodyState | null | undefined,
  candidateChain: number,
  eventTs: bigint,
): CustodyState | null {
  const prior = existing?.custodyUpdatedAt ?? 0n;
  if (eventTs < prior) return null;
  return { custodyChain: candidateChain, custodyUpdatedAt: eventTs };
}

export type ProvenanceRecord = {
  id: string;
  tokenId: string;
  chainId: number;
  timestamp: bigint;
};

/**
 * UNION of chain-sharded records by global tokenId, sorted by timestamp then id.
 * Both commercial chains write into the same table — this is the API aggregation shape.
 */
export function unionRecordsByTokenId<T extends ProvenanceRecord>(
  rows: readonly T[],
  tokenId: string,
): T[] {
  return rows
    .filter((row) => row.tokenId === tokenId)
    .slice()
    .sort((a, b) => {
      if (a.timestamp === b.timestamp) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      return a.timestamp < b.timestamp ? -1 : 1;
    });
}

export type PassportCustodyReducerState = {
  chainId: number;
  custodyChain: number;
  custodyUpdatedAt: bigint;
};

/**
 * Apply a custody event with monotonic gate (test / reducer matrix).
 * `eventTs` defaults to `custodyUpdatedAt + 1n` when omitted (in-order path).
 */
export function applyCustodyEvent(
  state: PassportCustodyReducerState,
  event: CustodyEvent,
  eventTs?: bigint,
): PassportCustodyReducerState {
  const next = nextCustodyChain(state.custodyChain, event);
  if (next === undefined) return state;
  const ts = eventTs ?? state.custodyUpdatedAt + 1n;
  const resolved = resolveCustody(state, next, ts);
  if (resolved === null) return state;
  return {
    chainId: state.chainId,
    custodyChain: resolved.custodyChain,
    custodyUpdatedAt: resolved.custodyUpdatedAt,
  };
}
