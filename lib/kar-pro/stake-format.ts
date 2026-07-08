import { formatEther } from "viem";

export function formatStakeEth(wei: bigint | undefined): string {
  if (wei === undefined) return "0.05";
  const formatted = formatEther(wei);
  const num = Number.parseFloat(formatted);
  return Number.isFinite(num) ? num.toFixed(2) : formatted;
}
