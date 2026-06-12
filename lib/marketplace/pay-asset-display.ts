import { formatEther, formatUnits } from "viem";

/** Matches `MarketplaceEscrow` Sale event: 0 = native wei, 1 = USDC (6 decimals). */
export function formatSaleAmount(payAsset: number, amountRaw: string): string {
  if (payAsset === 1) {
    return `${formatUnits(BigInt(amountRaw), 6)} USDC`;
  }
  return `${formatEther(BigInt(amountRaw))} native`;
}
