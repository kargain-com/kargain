import { formatUnits } from "viem";

/** Format claim amount with on-chain decimals; fail-closed raw when decimals missing. */
export function formatClaimAmount(params: {
  amount: bigint;
  decimals: number | null;
  symbol: string | null;
  nativeSymbol?: string;
  isNative: boolean;
}): string {
  const { amount, decimals, symbol, nativeSymbol, isNative } = params;
  const unit =
    isNative
      ? (nativeSymbol ?? "ETH")
      : symbol && symbol.length > 0
        ? symbol
        : null;

  if (decimals == null || !Number.isFinite(decimals) || decimals < 0 || decimals > 36) {
    return unit ? `${amount.toString()} ${unit}` : amount.toString();
  }

  const formatted = formatUnits(amount, decimals);
  return unit ? `${formatted} ${unit}` : formatted;
}
