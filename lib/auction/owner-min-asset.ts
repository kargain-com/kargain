import { formatUnits, parseUnits } from "viem";

import { resolveSettlementAssetMeta } from "@/lib/commerce/settlement-asset-meta";
import type { CommercialNativeUnit } from "@/lib/web3/commercial-native-unit";
import {
  formatNativeAmount,
  parseNativeAmount,
} from "@/lib/web3/native-amount";

export type AuctionAssetLabel = "ETH" | "USDC";

const USDC_DECIMALS = 6;

/** Parse a human amount string into asset units (native base / USDC 6-decimals). */
export function parseOwnerMinAsset(
  input: string,
  assetLabel: AuctionAssetLabel,
  nativeUnit: CommercialNativeUnit,
): bigint | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    if (assetLabel === "USDC") {
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
  if (assetLabel === "USDC") {
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
 * Map chain asset address to ascending UI label (ETH | USDC).
 * Delegates identity to {@link resolveSettlementAssetMeta}; unknown non-native
 * admits collapse to USDC (sole ERC-20 on commercial chains today).
 * Native uses the stack symbol when it is ETH; other symbols still map to the
 * ETH auction label slot until ascending admits non-ETH natives in UI.
 */
export function auctionAssetLabelFromAddress(
  asset: string | undefined | null,
  chainId: number,
): AuctionAssetLabel {
  const meta = resolveSettlementAssetMeta({ chainId, asset });
  if (meta.identity === "native") return "ETH";
  if (meta.identity === "usdc") return "USDC";
  return "USDC";
}
