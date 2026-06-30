import { getAddress, stringToHex, type Hex } from "viem";

/** ISO codes supported for on-chain listing denomination (per-chain subset). */
export const LISTING_CURRENCY_CODES = [
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "CAD",
] as const;

export type ListingCurrencyCode = (typeof LISTING_CURRENCY_CODES)[number];

/** Canonical display-layer fiat codes (legacy enum indices 0–7). */
export const LEGACY_FIAT_CURRENCIES = [
  "USD",
  "EUR",
  "CNY",
  "INR",
  "BRL",
  "IDR",
  "AUD",
  "AED",
] as const;

export type LegacyFiatCurrencyCode = (typeof LEGACY_FIAT_CURRENCIES)[number];
export type LegacyFiatCurrency = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const DISPLAY_CURRENCIES = [...LEGACY_FIAT_CURRENCIES, "ETH"] as const;
export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];

export function isDisplayCurrency(value: string): value is DisplayCurrency {
  return (DISPLAY_CURRENCIES as readonly string[]).includes(value);
}

export function isLegacyFiatCurrency(n: number): n is LegacyFiatCurrency {
  return Number.isInteger(n) && n >= 0 && n <= 7;
}

export function legacyFiatToCode(n: LegacyFiatCurrency): LegacyFiatCurrencyCode {
  return LEGACY_FIAT_CURRENCIES[n];
}

/** chainId → listing currency codes registered at deploy (SPEC §5.1). */
const LISTING_CURRENCIES_BY_CHAIN: Record<number, readonly ListingCurrencyCode[]> = {
  84532: ["USD"],
  11155111: ["USD", "EUR", "GBP", "JPY"],
  80002: ["USD"],
  8453: ["USD", "EUR", "GBP", "CAD"],
};

const DEFAULT_LISTING_CURRENCIES: readonly ListingCurrencyCode[] = ["USD"];

export function listingCurrencyCodesForChain(chainId: number): readonly ListingCurrencyCode[] {
  return LISTING_CURRENCIES_BY_CHAIN[chainId] ?? DEFAULT_LISTING_CURRENCIES;
}

/** Encode ISO 4217 code for MarketplaceEscrow `currencyCode` (bytes32). */
export function encodeCurrencyCode(iso: string): Hex {
  return stringToHex(iso, { size: 32 });
}

/** Decode ISO-style bytes32 currency code from MarketplaceEscrow events. */
export function decodeCurrencyCode(code: Hex | string): string {
  const hex = code.startsWith("0x") ? code.slice(2) : code;
  if (hex.length !== 64) return "";
  let out = "";
  for (let i = 0; i < 64; i += 2) {
    const byte = Number.parseInt(hex.slice(i, i + 2), 16);
    if (byte === 0) break;
    out += String.fromCharCode(byte);
  }
  return out;
}

/** Map v2 currencyCode to legacy fiat enum for API/filter compat. */
export function legacyFiatFromCurrencyCode(code: string): LegacyFiatCurrency {
  const upper = code.toUpperCase();
  const index = (LEGACY_FIAT_CURRENCIES as readonly string[]).indexOf(upper);
  if (index >= 0) return index as LegacyFiatCurrency;
  return 0;
}

/** Map v2 payToken to legacy payAsset enum (0=native, 1=USDC). */
export function payTokenToLegacyPayAsset(
  payToken: string,
  usdcAddress: string,
): 0 | 1 {
  if (!payToken || payToken === "0x0000000000000000000000000000000000000000") {
    return 0;
  }
  try {
    return getAddress(payToken) === getAddress(usdcAddress) ? 1 : 0;
  } catch {
    return 0;
  }
}
