import { getAddress, zeroAddress } from "viem";

/**
 * Chain view-model for an ascending lot, assembled from `AscendingConsignment`
 * per-token getters (consignment slot + snapshotted auction terms).
 */
export type OnChainAuction = {
  seller: `0x${string}`;
  agent: `0x${string}`;
  /** Commission bps when the lot pays an agent a commission. */
  agentFeeBps: number;
  asset: `0x${string}`;
  /** Empty string when native ETH (address(0)). */
  assetNormalized: string;
  reserve: bigint;
  ownerMinAsset: bigint;
  duration: bigint;
  startedAt: bigint;
  endsAt: bigint;
  highestBidder: `0x${string}`;
  highestBid: bigint;
  active: boolean;
};

/**
 * Settlement hold on an ascending lot. `disputedAt` / `bond` carry the
 * BondedChallenge opened against the lot; `refundPendingAt` is the reversal
 * abandonment deadline.
 */
export type OnChainHold = {
  buyer: `0x${string}`;
  gross: bigint;
  releaseAt: bigint;
  disputedAt: bigint;
  bond: bigint;
  refundPendingAt: bigint;
  /** True when a settlement hold is open (`releaseAt != 0`). */
  open: boolean;
};

export type AscendingAuctionFields = {
  phase: number | undefined;
  seller: string | undefined;
  agent: string | undefined;
  commissionBps: number | undefined;
  asset: string | undefined;
  reserve: bigint | undefined;
  floor: bigint | undefined;
  duration: bigint | number | undefined;
  openedAt: bigint | number | undefined;
  endsAt: bigint | number | undefined;
  highestBidder: string | undefined;
  highestBid: bigint | undefined;
};

export type AscendingHoldFields = {
  buyer: string | undefined;
  gross: bigint | undefined;
  protectionEndsAt: bigint | number | undefined;
  reversalPending: boolean | undefined;
  abandonmentDeadline: bigint | number | undefined;
  challengeOpenedAt: bigint | number | undefined;
  challengeBond: bigint | undefined;
};

function asBigInt(value: bigint | number | string | undefined): bigint {
  if (value == null) return 0n;
  if (typeof value === "bigint") return value;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function asAddress(value: string | undefined): `0x${string}` {
  if (!value) return zeroAddress;
  try {
    return getAddress(value);
  } catch {
    return zeroAddress;
  }
}

/**
 * Assemble the lot view-model. Returns `null` when the consignment slot is
 * empty (phase `None`) so callers keep commerce CTAs hidden.
 */
export function buildOnChainAuction(
  fields: AscendingAuctionFields,
): OnChainAuction | null {
  if (fields.phase == null) return null;
  const asset = asAddress(fields.asset);
  const highestBid = fields.highestBid ?? 0n;
  const endsAt = asBigInt(fields.endsAt);

  return {
    seller: asAddress(fields.seller),
    agent: asAddress(fields.agent),
    agentFeeBps: Number(fields.commissionBps ?? 0),
    asset,
    assetNormalized: asset === zeroAddress ? "" : asset,
    reserve: fields.reserve ?? 0n,
    ownerMinAsset: fields.floor ?? 0n,
    duration: asBigInt(fields.duration),
    startedAt: highestBid > 0n ? asBigInt(fields.openedAt) : 0n,
    endsAt,
    highestBidder: asAddress(fields.highestBidder),
    highestBid,
    // Offered (1) is the only live phase; Closed / Returned end the lot.
    active: fields.phase === 1,
  };
}

/** Assemble the settlement hold; `null` when no buyer is held. */
export function buildOnChainHold(
  fields: AscendingHoldFields,
): OnChainHold | null {
  const buyer = asAddress(fields.buyer);
  if (buyer === zeroAddress) return null;
  const releaseAt = asBigInt(fields.protectionEndsAt);

  return {
    buyer,
    gross: fields.gross ?? 0n,
    releaseAt,
    disputedAt: asBigInt(fields.challengeOpenedAt),
    bond: fields.challengeBond ?? 0n,
    refundPendingAt: fields.reversalPending
      ? asBigInt(fields.abandonmentDeadline)
      : 0n,
    open: releaseAt !== 0n,
  };
}
