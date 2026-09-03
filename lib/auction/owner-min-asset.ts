import { formatUnits, parseUnits } from "viem";

import { resolveSettlementAssetMeta } from "@/lib/commerce/settlement-asset-meta";
import type { CommercialNativeUnit } from "@/lib/web3/commercial-native-unit";
import {
  formatNativeAmount,
  parseNativeAmount,
} from "@/lib/web3/native-amount";

export type AuctionAssetLabel = string;

const USDC_LABEL = "USDC";
const USDC_DECIMALS = 6;

function isUsdcAuctionLabel(assetLabel: string): boolean {
  return assetLabel === USDC_LABEL;
}

/** Parse a human amount string into asset units (native base / USDC 6-decimals). */
export function parseOwnerMinAsset(
  input: string,
  assetLabel: AuctionAssetLabel,
  nativeUnit: CommercialNativeUnit,
): bigint | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    if (isUsdcAuctionLabel(assetLabel)) {
      return parseUnits(trimmed, USDC_DECIMALS);
    }
    return parseNativeAmount(trimmed, nativeUnit);
  } catch {
    return null;
  }
}

/** Format asset units for form/readout (no currency suffix). */
export function formatOwnerMinAsset(
  amount: bigint,
  assetLabel: AuctionAssetLabel,
  nativeUnit: CommercialNativeUnit,
): string {
  if (isUsdcAuctionLabel(assetLabel)) {
    return formatUnits(amount, USDC_DECIMALS);
  }
  return formatNativeAmount(amount, nativeUnit);
}

/** True when parse succeeds and amount is strictly greater than zero. */
export function isValidOwnerMinAsset(
  input: string,
  assetLabel: AuctionAssetLabel,
  nativeUnit: CommercialNativeUnit,
): boolean {
  const parsed = parseOwnerMinAsset(input, assetLabel, nativeUnit);
  return parsed != null && parsed > 0n;
}

/**
 * Map chain asset address to ascending UI label from settlement meta
 * (native symbol from the network class — never invent ETH).
 */
export function auctionAssetLabelFromAddress(
  asset: string | undefined | null,
  chainId: number,
): AuctionAssetLabel {
  return resolveSettlementAssetMeta({ chainId, asset }).label;
}
