/**
 * Branded commercial native-unit metadata (S8-1-close).
 * Mint at registry ingress only — same shape as {@link KargainNamespace}.
 */

declare const commercialNativeUnitBrand: unique symbol;

export type CommercialNativeUnit = {
  readonly symbol: string;
  readonly decimals: number;
  readonly [commercialNativeUnitBrand]: void;
};

/** Mint a native unit — registry / fixture ingress only. */
export function mintCommercialNativeUnit(
  symbol: string,
  decimals: number,
): CommercialNativeUnit {
  const trimmed = symbol.trim();
  if (trimmed.length === 0) {
    throw new Error(`Invalid CommercialNativeUnit: empty symbol`);
  }
  if (!Number.isInteger(decimals) || !Number.isFinite(decimals) || decimals < 0) {
    throw new Error(`Invalid CommercialNativeUnit: decimals ${decimals}`);
  }
  return { symbol: trimmed, decimals } as CommercialNativeUnit;
}
