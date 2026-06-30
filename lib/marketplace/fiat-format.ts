import {
  legacyFiatToCode,
  type LegacyFiatCurrencyCode,
} from "@/lib/marketplace/currency-code";
import { normalizeListingFiatCurrency } from "@/lib/marketplace/price-normalize";

/** On-chain fiat is stored with 8 decimals (Chainlink-style 1e8). */
export function formatFiat1e8(raw: string | bigint): string {
  const n = typeof raw === "bigint" ? raw : BigInt(raw);
  const neg = n < 0n;
  const v = neg ? -n : n;
  const whole = v / 100_000_000n;
  const frac = v % 100_000_000n;
  const fracStr = frac.toString().padStart(8, "0").replace(/0+$/, "");
  const core = fracStr ? `${whole.toString()}.${fracStr}` : whole.toString();
  return neg ? `-${core}` : core;
}

export function fiatCurrencyLabel(currency: number): LegacyFiatCurrencyCode {
  return legacyFiatToCode(normalizeListingFiatCurrency(currency));
}

const FIAT_SYMBOLS: Record<LegacyFiatCurrencyCode, string> = {
  USD: "$",
  EUR: "€",
  CNY: "¥",
  INR: "₹",
  BRL: "R$",
  IDR: "Rp",
  AUD: "A$",
  AED: "AED",
  KRW: "₩",
  RUB: "₽",
  JPY: "¥",
};

export function fiatCurrencySymbol(code: LegacyFiatCurrencyCode): string {
  return FIAT_SYMBOLS[code];
}

/** Selector-style label: symbol + ISO code (e.g. "$ USD"). */
export function fiatCurrencyOptionLabel(code: LegacyFiatCurrencyCode): string {
  const symbol = fiatCurrencySymbol(code);
  if (symbol === code) return code;
  return `${symbol} ${code}`;
}
