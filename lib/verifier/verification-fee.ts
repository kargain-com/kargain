import { formatEther } from "viem";

import { ETH_SCALE, FIAT_SCALE } from "@/lib/marketplace/price-normalize";

const USDC_SCALE = 1_000_000n;

export function formatVerificationFee(fee: bigint): string {
  if (fee === 0n) return "Contact for quote";
  return `${formatEther(fee)} ETH`;
}

export function verificationFeeInUsdc(
  feeWei: bigint,
  ethUsd1e8: bigint,
): bigint {
  if (feeWei === 0n || ethUsd1e8 === 0n) return 0n;
  return (feeWei * ethUsd1e8 * USDC_SCALE) / (ETH_SCALE * FIAT_SCALE);
}
