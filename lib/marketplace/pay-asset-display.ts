import { formatUnits } from "viem";

import type { CommercialNativeUnit } from "@/lib/web3/commercial-native-unit";
import { formatNativeAmount } from "@/lib/web3/native-amount";

/** Matches FixedPriceConsignment sale pay-asset enum: 0 = native, 1 = USDC (6 decimals). */
export function formatSaleAmount(
  payAsset: number,
  amountRaw: string,
  nativeUnit: CommercialNativeUnit,
): string {
  if (payAsset === 1) {
    return `${formatUnits(BigInt(amountRaw), 6)} USDC`;
  }
  return `${formatNativeAmount(BigInt(amountRaw), nativeUnit)} native`;
}
