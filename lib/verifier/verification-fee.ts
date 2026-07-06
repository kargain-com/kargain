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

const BTC_WEI_PER_SAT = 10n ** 10n;

export function verificationFeeInSats(
  feeWei: bigint,
  ethUsd1e8: bigint,
  btcUsd1e8: bigint,
): bigint {
  if (feeWei <= 0n || ethUsd1e8 <= 0n || btcUsd1e8 <= 0n) return 0n;

  const numerator = feeWei * ethUsd1e8;
  const denominator = btcUsd1e8 * BTC_WEI_PER_SAT;
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder === 0n) return quotient;
  return quotient + 1n;
}
