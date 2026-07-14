import {
  formatEther,
  formatUnits,
  getAddress,
  parseEther,
  parseUnits,
  zeroAddress,
} from "viem";

export type AuctionAssetLabel = "ETH" | "USDC";

const USDC_DECIMALS = 6;

/** Parse a human amount string into asset units (wei / USDC 6-decimals). */
export function parseOwnerMinAsset(
  input: string,
  assetLabel: AuctionAssetLabel,
): bigint | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    if (assetLabel === "USDC") {
      return parseUnits(trimmed, USDC_DECIMALS);
    }
    return parseEther(trimmed);
  } catch {
    return null;
  }
}

/** Format asset units for form/readout (no currency suffix). */
export function formatOwnerMinAsset(
  amount: bigint,
  assetLabel: AuctionAssetLabel,
): string {
  if (assetLabel === "USDC") {
    return formatUnits(amount, USDC_DECIMALS);
  }
  return formatEther(amount);
}

/** True when parse succeeds and amount is strictly greater than zero. */
export function isValidOwnerMinAsset(
  input: string,
  assetLabel: AuctionAssetLabel,
): boolean {
  const parsed = parseOwnerMinAsset(input, assetLabel);
  return parsed != null && parsed > 0n;
}

/** Map chain asset address to UI label (native zero = ETH). */
export function auctionAssetLabelFromAddress(
  asset: string | undefined | null,
): AuctionAssetLabel {
  if (!asset?.trim()) return "ETH";
  try {
    return getAddress(asset) === zeroAddress ? "ETH" : "USDC";
  } catch {
    return "USDC";
  }
}
