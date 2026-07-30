import { formatReturnCountdown } from "@/lib/marketplace/return-cooldown";

/** Mirrors `Recall.RECALL_COOLDOWN` — 7 days in seconds. */
export const RECALL_COOLDOWN_SECONDS = 604_800n;

export type RecallPhase = "none" | "pending" | "ready";

export function recallDeadline(requestedAt: bigint): bigint {
  return requestedAt + RECALL_COOLDOWN_SECONDS;
}

export function recallRemainingSeconds(requestedAt: bigint, nowSec: bigint): bigint {
  const remaining = recallDeadline(requestedAt) - nowSec;
  return remaining > 0n ? remaining : 0n;
}

export function recallPhase(requestedAt: bigint, nowSec: bigint): RecallPhase {
  if (requestedAt <= 0n) return "none";
  return recallRemainingSeconds(requestedAt, nowSec) > 0n ? "pending" : "ready";
}

export function formatRecallCountdown(remainingSec: bigint): string {
  return formatReturnCountdown(remainingSec);
}

/**
 * Chain read wins once resolved; the indexed value only fills the gap while
 * the read is pending. Zero from either source means “no recall requested”.
 */
export function effectiveRecallRequestedAt(
  indexed: string | number | bigint | null | undefined,
  chain: bigint | undefined,
): bigint {
  if (chain != null) return chain;
  if (indexed == null) return 0n;
  try {
    const parsed = BigInt(indexed);
    return parsed > 0n ? parsed : 0n;
  } catch {
    return 0n;
  }
}

/**
 * Owner recall policy: request while an agented consignment is live, force
 * once the cooldown elapses. Direct (unagented) consignments close by delist.
 */
export type RecallActions = {
  readonly canRequest: boolean;
  readonly canForce: boolean;
  readonly phase: RecallPhase;
  readonly remainingSeconds: bigint;
};

export function deriveRecallActions(input: {
  isOwner: boolean;
  hasAgent: boolean;
  isLive: boolean;
  requestedAt: bigint;
  nowSec: bigint;
}): RecallActions {
  const { isOwner, hasAgent, isLive, requestedAt, nowSec } = input;
  const phase = recallPhase(requestedAt, nowSec);
  const remainingSeconds = recallRemainingSeconds(requestedAt, nowSec);
  const eligible = isOwner && hasAgent && isLive;
  return {
    canRequest: eligible && phase === "none",
    canForce: eligible && phase === "ready",
    phase,
    remainingSeconds,
  };
}
