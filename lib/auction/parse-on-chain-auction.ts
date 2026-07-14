import { getAddress, zeroAddress } from "viem";

export type OnChainAuction = {
  seller: `0x${string}`;
  agent: `0x${string}`;
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

type AuctionTuple = readonly [
  `0x${string}`,
  `0x${string}`,
  number | bigint,
  `0x${string}`,
  bigint,
  bigint,
  bigint | number,
  bigint | number,
  bigint | number,
  `0x${string}`,
  bigint,
  boolean,
];

type HoldTuple = readonly [
  `0x${string}`,
  bigint,
  bigint | number,
  bigint | number,
  bigint,
  bigint | number,
];

function asBigInt(value: bigint | number | string): bigint {
  if (typeof value === "bigint") return value;
  return BigInt(value);
}

function asAddress(value: string): `0x${string}` {
  try {
    return getAddress(value);
  } catch {
    return zeroAddress;
  }
}

/** Decode `AuctionEscrow.auctions(tokenId)` result (object or positional tuple). */
export function parseOnChainAuction(raw: unknown): OnChainAuction | null {
  if (raw == null) return null;

  if (Array.isArray(raw) && raw.length >= 12) {
    const t = raw as unknown as AuctionTuple;
    const asset = asAddress(String(t[3]));
    return {
      seller: asAddress(String(t[0])),
      agent: asAddress(String(t[1])),
      agentFeeBps: Number(t[2]),
      asset,
      assetNormalized: asset === zeroAddress ? "" : asset,
      reserve: asBigInt(t[4]),
      ownerMinAsset: asBigInt(t[5]),
      duration: asBigInt(t[6]),
      startedAt: asBigInt(t[7]),
      endsAt: asBigInt(t[8]),
      highestBidder: asAddress(String(t[9])),
      highestBid: asBigInt(t[10]),
      active: Boolean(t[11]),
    };
  }

  if (typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    if (o.seller == null || o.reserve == null) return null;
    const asset = asAddress(String(o.asset ?? zeroAddress));
    return {
      seller: asAddress(String(o.seller)),
      agent: asAddress(String(o.agent ?? zeroAddress)),
      agentFeeBps: Number(o.agentFeeBps ?? 0),
      asset,
      assetNormalized: asset === zeroAddress ? "" : asset,
      reserve: asBigInt(o.reserve as bigint | number | string),
      ownerMinAsset: asBigInt((o.ownerMinAsset ?? 0) as bigint | number | string),
      duration: asBigInt((o.duration ?? 0) as bigint | number | string),
      startedAt: asBigInt((o.startedAt ?? 0) as bigint | number | string),
      endsAt: asBigInt((o.endsAt ?? 0) as bigint | number | string),
      highestBidder: asAddress(String(o.highestBidder ?? zeroAddress)),
      highestBid: asBigInt((o.highestBid ?? 0) as bigint | number | string),
      active: Boolean(o.active),
    };
  }

  return null;
}

/** Decode `AuctionEscrow.holds(tokenId)` result. */
export function parseOnChainHold(raw: unknown): OnChainHold | null {
  if (raw == null) return null;

  if (Array.isArray(raw) && raw.length >= 6) {
    const t = raw as unknown as HoldTuple;
    const releaseAt = asBigInt(t[2]);
    return {
      buyer: asAddress(String(t[0])),
      gross: asBigInt(t[1]),
      releaseAt,
      disputedAt: asBigInt(t[3]),
      bond: asBigInt(t[4]),
      refundPendingAt: asBigInt(t[5]),
      open: releaseAt !== 0n,
    };
  }

  if (typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    if (o.buyer == null || o.releaseAt == null) return null;
    const releaseAt = asBigInt(o.releaseAt as bigint | number | string);
    return {
      buyer: asAddress(String(o.buyer)),
      gross: asBigInt((o.gross ?? 0) as bigint | number | string),
      releaseAt,
      disputedAt: asBigInt((o.disputedAt ?? 0) as bigint | number | string),
      bond: asBigInt((o.bond ?? 0) as bigint | number | string),
      refundPendingAt: asBigInt((o.refundPendingAt ?? 0) as bigint | number | string),
      open: releaseAt !== 0n,
    };
  }

  return null;
}
