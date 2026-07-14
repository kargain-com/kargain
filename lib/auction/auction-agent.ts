import { getAddress, zeroAddress } from "viem";

import {
  computeSellerNet,
  MAX_AGENT_FEE_BPS,
  satisfiesOwnerMin,
} from "@/lib/marketplace/seller-net";

export type AuctionAgentAuth = {
  agent: `0x${string}`;
  expiry: bigint;
  asset: `0x${string}`;
  ownerMinAsset: bigint;
  active: boolean;
};

type AuthTuple = readonly [
  `0x${string}`,
  bigint | number,
  `0x${string}`,
  bigint | number,
  boolean,
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

/** Decode `AuctionEscrow.auctionAgentAuthorizations(tokenId)` (object or tuple). */
export function parseAuctionAgentAuthorization(
  raw: unknown,
): AuctionAgentAuth | null {
  if (raw == null) return null;

  if (Array.isArray(raw) && raw.length >= 5) {
    const t = raw as unknown as AuthTuple;
    return {
      agent: asAddress(String(t[0])),
      expiry: asBigInt(t[1]),
      asset: asAddress(String(t[2])),
      ownerMinAsset: asBigInt(t[3]),
      active: Boolean(t[4]),
    };
  }

  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (o.agent == null || o.asset == null) return null;
    return {
      agent: asAddress(String(o.agent)),
      expiry: asBigInt((o.expiry as bigint | number | string) ?? 0),
      asset: asAddress(String(o.asset)),
      ownerMinAsset: asBigInt(
        (o.ownerMinAsset as bigint | number | string) ?? 0,
      ),
      active: Boolean(o.active),
    };
  }

  return null;
}

export function hasAuctionAgent(
  agent: string | undefined | null,
): boolean {
  if (!agent?.trim()) return false;
  try {
    return getAddress(agent) !== zeroAddress;
  } catch {
    return false;
  }
}

/** `expiry === 0` means no expiry. */
export function isAuctionAuthExpired(
  expiry: bigint,
  nowSec: number,
): boolean {
  if (expiry === 0n) return false;
  return expiry < BigInt(nowSec);
}

/**
 * Authorization is usable for `createAuctionOnBehalf`: active, non-zero agent,
 * and not expired. Expired auths remain revocable by the owner.
 */
export function isAuctionAuthUsableForCreate(
  auth: AuctionAgentAuth | null | undefined,
  nowSec: number,
): boolean {
  if (!auth?.active) return false;
  if (!hasAuctionAgent(auth.agent)) return false;
  if (isAuctionAuthExpired(auth.expiry, nowSec)) return false;
  return true;
}

/**
 * True when `reserve − agentFee − platformFee >= ownerMinAsset`.
 * Mirrors AuctionEscrow / BelowOwnerMinAsset.
 */
export function auctionReserveMeetsOwnerMin(
  reserve: bigint | null,
  agentFeeBps: number,
  platformFeeBps: bigint | null | undefined,
  ownerMinAsset: bigint,
): boolean {
  if (reserve == null || reserve <= 0n) return false;
  if (platformFeeBps == null) return false;
  if (agentFeeBps < 0 || agentFeeBps > MAX_AGENT_FEE_BPS) return false;
  const { sellerNet } = computeSellerNet(reserve, agentFeeBps, platformFeeBps);
  return satisfiesOwnerMin(sellerNet, ownerMinAsset);
}

export { MAX_AGENT_FEE_BPS };
