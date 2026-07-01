import { getAddress, zeroAddress } from "viem";

export function hasListingAgent(agent: string | undefined | null): boolean {
  if (!agent?.trim()) return false;
  try {
    return getAddress(agent) !== zeroAddress;
  } catch {
    return false;
  }
}

export function parseReturnRequestedAt(
  value: string | number | bigint | undefined | null,
): bigint {
  if (value == null || value === "" || value === "0") return 0n;
  try {
    const parsed = BigInt(value);
    return parsed > 0n ? parsed : 0n;
  } catch {
    return 0n;
  }
}

export function effectiveReturnRequestedAt(
  ponderAt: bigint,
  chainAt: bigint | undefined,
): bigint {
  if (chainAt != null && chainAt > ponderAt) return chainAt;
  return ponderAt;
}
