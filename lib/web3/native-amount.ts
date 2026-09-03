/**
 * Sole product parse/format owner for commercial native amounts (S8-4).
 * Decimal count and symbol come from {@link CommercialNativeUnit} — never assumed.
 * Wallet-family ether helpers and literal eighteen live only here if needed; prefer units API.
 */

import { formatUnits, parseUnits } from "viem";

import type { CommercialNativeUnit } from "@/lib/web3/commercial-native-unit";

export type FormatNativeAmountOpts = {
  /** Cap displayed fractional digits after grouping (auction-style). */
  maxFractionDigits?: number;
  /** Fixed fractional digits (stake-style `toFixed`). */
  fixedFractionDigits?: number;
  /** Locale grouping via `toLocaleString` when fraction opts apply. */
  localeGroup?: boolean;
};

/** `10n ** decimals` for FX / wei-scale arithmetic. */
export function nativeAmountScale(unit: CommercialNativeUnit): bigint {
  return 10n ** BigInt(unit.decimals);
}

/**
 * Parse a human decimal string into native base units.
 * Invalid / empty → null (never throws).
 */
export function parseNativeAmount(
  text: string,
  unit: CommercialNativeUnit,
): bigint | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return parseUnits(trimmed, unit.decimals);
  } catch {
    return null;
  }
}

/**
 * Parse with round-up when fractional digits exceed `unit.decimals`
 * (fee-composer margin path). Negatives → null.
 */
export function parseNativeAmountRoundUp(
  text: string,
  unit: CommercialNativeUnit,
): bigint | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const negative = trimmed.startsWith("-");
  const raw = negative ? trimmed.slice(1) : trimmed;
  if (!raw || raw === ".") return null;

  const [wholePart, fracPart = ""] = raw.split(".");
  if (!/^\d*$/.test(wholePart) || !/^\d*$/.test(fracPart)) return null;

  const scale = nativeAmountScale(unit);
  const decimals = unit.decimals;
  const whole = BigInt(wholePart || "0");
  const padded = (fracPart + "0".repeat(decimals)).slice(0, decimals);
  const extra = fracPart.length > decimals ? fracPart.slice(decimals) : "";
  let amount = whole * scale + BigInt(padded || "0");
  if (extra.split("").some((d) => d !== "0")) amount += 1n;

  if (negative) return null;
  return amount;
}

/**
 * Format native base units to a decimal string (no symbol).
 * With fraction opts: locale-group or fixed digits as requested.
 * Without opts: full `formatUnits` precision (trim not applied).
 */
export function formatNativeAmount(
  amount: bigint,
  unit: CommercialNativeUnit,
  opts?: FormatNativeAmountOpts,
): string {
  const raw = formatUnits(amount, unit.decimals);

  if (opts?.fixedFractionDigits != null) {
    const num = Number.parseFloat(raw);
    if (!Number.isFinite(num)) return raw;
    return num.toFixed(opts.fixedFractionDigits);
  }

  if (opts?.maxFractionDigits != null || opts?.localeGroup) {
    const num = Number.parseFloat(raw);
    if (!Number.isFinite(num)) return raw;
    const max =
      opts.maxFractionDigits ??
      (num >= 1 ? 4 : 6);
    if (opts.localeGroup !== false) {
      return num.toLocaleString("en-US", { maximumFractionDigits: max });
    }
    return num.toFixed(Math.min(max, unit.decimals));
  }

  return raw;
}

/** Format with unit symbol: `"{amount} {symbol}"`. */
export function formatNativeAmountLabeled(
  amount: bigint,
  unit: CommercialNativeUnit,
  opts?: FormatNativeAmountOpts,
): string {
  return `${formatNativeAmount(amount, unit, opts)} ${unit.symbol}`;
}
