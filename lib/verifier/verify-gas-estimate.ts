/**
 * Gas units for verifyPassport — Hardhat EDR measured ~100,481 (receipt) /
 * ~105,988 (estimateGas) in July 2026; 110k headroom for L2 variance.
 */
export const VERIFY_PASSPORT_GAS_UNITS = 110_000n;

export function verifyGasCostWei(
  gasUnits: bigint,
  maxFeePerGasWei: bigint,
): bigint {
  if (gasUnits <= 0n || maxFeePerGasWei <= 0n) return 0n;
  return gasUnits * maxFeePerGasWei;
}
