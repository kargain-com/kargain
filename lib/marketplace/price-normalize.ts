import {
  isCryptoDisplayCurrency,
  isDisplayCurrency,
  legacyFiatToCode,
  type DisplayCurrency,
  type LegacyFiatCurrency,
  type LegacyFiatCurrencyCode,
} from "@/lib/marketplace/currency-code";
import {
  CRYPTO_DISPLAY_CONFIG,
  FIAT_RATE_KEYS,
  parseFxRatesFromQueryParams,
  type PartialFxRates,
} from "@/lib/marketplace/fx-rate-registry";

export type { PartialFxRates };

export const FIAT_SCALE = 100_000_000n;
export const ETH_SCALE = 1_000_000_000_000_000_000n;
export const BTC_SCALE = 100_000_000n;

export type PriceCurrency = DisplayCurrency;

export function isPriceCurrency(value: string): value is PriceCurrency {
  return isDisplayCurrency(value);
}

/** Coerce API / JSON fiat currency to legacy enum 0–10; invalid → 0 (USD). */
export function normalizeListingFiatCurrency(fiatCurrency: number | string): LegacyFiatCurrency {
  const n = Number(fiatCurrency);
  if (Number.isInteger(n) && n >= 0 && n <= 10) return n as LegacyFiatCurrency;
  return 0;
}

export type FxRates = {
  ethUsd: bigint;
  eurUsd: bigint;
  cnyUsd: bigint;
  inrUsd: bigint;
  brlUsd: bigint;
  idrUsd: bigint;
  audUsd: bigint;
  krwUsd: bigint;
  rubUsd: bigint;
  jpyUsd: bigint;
};

/** Parse individual rate query params into a partial rates object. */
export function parseFxRatesFromQuery(params: {
  eurUsdRate?: string;
  ethUsdRate?: string;
  btcUsdRate?: string;
  cnyUsdRate?: string;
  inrUsdRate?: string;
  brlUsdRate?: string;
  idrUsdRate?: string;
  audUsdRate?: string;
  aedUsdRate?: string;
  krwUsdRate?: string;
  rubUsdRate?: string;
  jpyUsdRate?: string;
}): PartialFxRates {
  return parseFxRatesFromQueryParams(params);
}

/** @deprecated Use parseFxRatesFromQuery — kept for call sites passing two rates. */
export function parseFxRates(
  eurUsdRate?: string,
  ethUsdRate?: string,
): FxRates | null {
  const partial = parseFxRatesFromQuery({ eurUsdRate, ethUsdRate });
  if (partial.eurUsd == null || partial.ethUsd == null) return null;
  return {
    ethUsd: partial.ethUsd,
    eurUsd: partial.eurUsd,
    cnyUsd: partial.cnyUsd ?? 0n,
    inrUsd: partial.inrUsd ?? 0n,
    brlUsd: partial.brlUsd ?? 0n,
    idrUsd: partial.idrUsd ?? 0n,
    audUsd: partial.audUsd ?? 0n,
    krwUsd: partial.krwUsd ?? 0n,
    rubUsd: partial.rubUsd ?? 0n,
    jpyUsd: partial.jpyUsd ?? 0n,
  };
}

/** USD per 1 unit of fiat at 1e8 scale. */
export function fiatUsdRate(
  code: LegacyFiatCurrencyCode,
  rates: PartialFxRates | null,
): bigint | null {
  if (code === "USD") return FIAT_SCALE;
  const key = FIAT_RATE_KEYS[code];
  const rate = rates?.[key];
  return rate != null && rate > 0n ? rate : null;
}

/** Whether a live FX rate is required for price filter/sort in this display currency. */
export function rateRequiredForPriceCurrency(currency: PriceCurrency): boolean {
  if (currency === "USD") return false;
  return true;
}

/** Check whether required rates for filter/sort are available. */
export function ratesReadyForPriceCurrency(
  currency: PriceCurrency,
  rates: PartialFxRates | null,
): boolean {
  if (!rateRequiredForPriceCurrency(currency)) return true;
  if (isCryptoDisplayCurrency(currency)) {
    const config = CRYPTO_DISPLAY_CONFIG[currency];
    const rate = rates?.[config.rateField];
    return rate != null && rate > 0n;
  }
  if (currency === "EUR") return rates?.eurUsd != null;
  const fiatRate = fiatUsdRate(currency, rates);
  return fiatRate != null;
}

/** Normalize on-chain listing price to USD 1e8. */
export function listingToUsd1e8(
  fiatPrice1e8: bigint,
  fiatCurrency: LegacyFiatCurrency,
  rates: PartialFxRates | null,
): bigint | null {
  const code = legacyFiatToCode(fiatCurrency);
  const rate = fiatUsdRate(code, rates);
  if (rate == null) return null;
  if (code === "USD") return fiatPrice1e8;
  return (fiatPrice1e8 * rate) / FIAT_SCALE;
}

/** Convert USD 1e8 to target fiat 1e8. */
export function usd1e8ToFiat1e8(
  usd1e8: bigint,
  targetCode: LegacyFiatCurrencyCode,
  rates: PartialFxRates | null,
): bigint | null {
  const rate = fiatUsdRate(targetCode, rates);
  if (rate == null) return null;
  if (targetCode === "USD") return usd1e8;
  return (usd1e8 * FIAT_SCALE) / rate;
}

/** Normalize on-chain listing price to EUR 1e8. */
export function listingToEur1e8(
  fiatPrice1e8: bigint,
  fiatCurrency: LegacyFiatCurrency,
  rates: PartialFxRates | null,
): bigint | null {
  const usd = listingToUsd1e8(fiatPrice1e8, fiatCurrency, rates);
  if (usd == null) return null;
  return usd1e8ToFiat1e8(usd, "EUR", rates);
}

/** Convert user-entered filter amount to USD 1e8 for comparison. */
export function displayAmountToUsd1e8(
  amount: string,
  priceCurrency: PriceCurrency,
  rates: PartialFxRates | null,
): bigint | undefined {
  const trimmed = amount.trim();
  if (!trimmed) return undefined;
  const n = Number.parseFloat(trimmed);
  if (!Number.isFinite(n) || n < 0) return undefined;

  if (priceCurrency === "USD") {
    return BigInt(Math.round(n * Number(FIAT_SCALE)));
  }

  if (isCryptoDisplayCurrency(priceCurrency)) {
    const config = CRYPTO_DISPLAY_CONFIG[priceCurrency];
    const cryptoRate = rates?.[config.rateField];
    if (cryptoRate == null || cryptoRate <= 0n) return undefined;
    const units = BigInt(Math.round(n * Number(config.scale)));
    return (units * cryptoRate) / config.scale;
  }

  const fiatCode = priceCurrency as LegacyFiatCurrencyCode;
  const fiatRate = fiatUsdRate(fiatCode, rates);
  if (fiatRate == null) return undefined;
  const fiat1e8 = BigInt(Math.round(n * Number(FIAT_SCALE)));
  return (fiat1e8 * fiatRate) / FIAT_SCALE;
}

/** USD 1e8 → ETH display number (for facet placeholders). */
export function fiat1e8ToEthWei(usd1e8: bigint, ethUsd: bigint): number {
  const ethWei = (usd1e8 * ETH_SCALE) / ethUsd;
  return Number(ethWei) / Number(ETH_SCALE);
}

/** USD 1e8 → BTC display number (for facet placeholders). */
export function fiat1e8ToBtc(usd1e8: bigint, btcUsd: bigint): number {
  const btcSat = (usd1e8 * BTC_SCALE) / btcUsd;
  return Number(btcSat) / Number(BTC_SCALE);
}

/** Convert USD facet bounds to crypto display units for filter sliders. */
export function usdFacetRangeToCrypto(
  usdMin: number,
  usdMax: number,
  cryptoUsd: bigint,
  scale: bigint,
): { min: number; max: number } {
  const toUnits = (usd: number): number => {
    if (!usd) return 0;
    const usd1e8 = BigInt(Math.round(usd * Number(FIAT_SCALE)));
    const units = (usd1e8 * scale) / cryptoUsd;
    return Number(units) / Number(scale);
  };
  return { min: toUnits(usdMin), max: toUnits(usdMax) };
}

export { FIAT_RATE_KEYS };
