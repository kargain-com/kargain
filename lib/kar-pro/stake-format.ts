import type { CommercialNativeUnit } from "@/lib/web3/commercial-native-unit";
import { formatNativeAmount } from "@/lib/web3/native-amount";

/**
 * Format min-stake / stake base units for KarPro chrome (2 fractional digits).
 * Unread amount keeps the historical default readout "0.05".
 */
export function formatStakeNative(
  amount: bigint | undefined,
  unit: CommercialNativeUnit,
): string {
  if (amount === undefined) return "0.05";
  return formatNativeAmount(amount, unit, { fixedFractionDigits: 2 });
}
