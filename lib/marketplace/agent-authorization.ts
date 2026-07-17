import { getAddress, zeroAddress } from "viem";

export type MarketplaceAgentAuth = {
  agent: `0x${string}`;
  expiry: bigint;
  ownerMinPrice1e8: bigint;
  active: boolean;
};

type AgentAuthTuple = readonly [
  `0x${string}`,
  bigint | number | string,
  bigint | number | string,
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

/** Decode `MarketplaceEscrow.agentAuthorizations(tokenId)` (object or tuple). */
export function parseMarketplaceAgentAuthorization(
  raw: unknown,
): MarketplaceAgentAuth | null {
  if (raw == null) return null;

  if (Array.isArray(raw) && raw.length >= 4) {
    const tuple = raw as unknown as AgentAuthTuple;
    return {
      agent: asAddress(String(tuple[0])),
      expiry: asBigInt(tuple[1]),
      ownerMinPrice1e8: asBigInt(tuple[2]),
      active: Boolean(tuple[3]),
    };
  }

  if (typeof raw === "object") {
    const object = raw as Record<string, unknown>;
    if (object.agent == null) return null;
    return {
      agent: asAddress(String(object.agent)),
      expiry: asBigInt(
        (object.expiry as bigint | number | string) ?? 0,
      ),
      ownerMinPrice1e8: asBigInt(
        (object.ownerMinPrice1e8 as bigint | number | string) ?? 0,
      ),
      active: Boolean(object.active),
    };
  }

  return null;
}
