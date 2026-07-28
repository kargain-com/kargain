import { getAddress, zeroAddress } from "viem";

/** Four-tuple balance PK — all address parts lowercased; chainId decimal. */
export function pendingClaimId(params: {
  chainId: number;
  contract: string;
  account: string;
  asset: string;
}): string {
  return [
    String(params.chainId),
    params.contract.toLowerCase(),
    params.account.toLowerCase(),
    params.asset.toLowerCase(),
  ].join("-");
}

export function claimCreditId(txHash: string, logIndex: number | bigint): string {
  return `${txHash.toLowerCase()}-${logIndex}`;
}

/** Normalize asset; native ETH is address(0). */
export function normalizeClaimAsset(asset: string): `0x${string}` {
  if (!asset || asset === "0" || /^0x0+$/i.test(asset)) return zeroAddress;
  return getAddress(asset);
}

export function isNativeClaimAsset(asset: string): boolean {
  return normalizeClaimAsset(asset) === zeroAddress;
}
