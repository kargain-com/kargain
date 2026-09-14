/**
 * Sole owner of verification-fee amount composition (SPEC I.4 / U6.2).
 *
 * Composition is VM-named — not a shared formatter with an `if (vm)` at the call site:
 * - EVM: service margin + estimated verifyPassport gas → wei
 * - SVM: service margin only → lamports (no gas / CU argument exists)
 */

import type { CommercialNativeUnit } from "@/lib/web3/commercial-native-unit";
import { parseNativeAmountRoundUp } from "@/lib/web3/native-amount";

import { composeTotalFeeWei } from "@/lib/verifier/fee-composer-math";

/**
 * EVM published fee: margin + optional gas estimate (unchanged product law).
 */
export function composeEvmVerificationFeeWei(
  marginWei: bigint,
  gasWei: bigint | null,
): bigint {
  return composeTotalFeeWei(marginWei, gasWei);
}

/**
 * SVM published fee: service margin only.
 * Deliberately has no gas/CU parameter — carrying EVM gas here is a type error.
 */
export function composeSvmVerificationFeeLamports(marginLamports: bigint): bigint {
  if (marginLamports <= 0n) return 0n;
  return marginLamports;
}

/**
 * Parse a decimal native-unit string into SVM fee base units (lamports on SOL).
 * Used when the fee panel enters the service margin in the stack native unit
 * (no SOL/USD FX in product rates today — honest native entry, not invented parity).
 */
export function parseSvmFeeMarginNative(
  input: string,
  unit: CommercialNativeUnit,
): bigint | null {
  const trimmed = input.trim();
  if (!trimmed || trimmed === "0") return 0n;
  return parseNativeAmountRoundUp(trimmed, unit);
}
