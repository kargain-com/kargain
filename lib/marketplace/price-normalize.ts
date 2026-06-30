import {
  isDisplayCurrency,
  legacyFiatToCode,
  type DisplayCurrency,
  type LegacyFiatCurrency,
  type LegacyFiatCurrencyCode,
} from "@/lib/marketplace/currency-code";

export const FIAT_SCALE = 100_000_000n;
export const ETH_SCALE = 1_000_000_000_000_000_000n;

/** UAE Central Bank peg: 1 AED = 0.2723 USD (stable since 1997). USD per 1 AED at 1e8. */
export const AED_USD_PEG_1E8 = 27_230_000n;

export type PriceCurrency = DisplayCurrency;

export function isPriceCurrency(value: string): value is PriceCurrency {
  return isDisplayCurrency(value);
}

/** Coerce API / JSON fiat currency to legacy enum 0–7; invalid → 0 (USD). */
export function normalizeListingFiatCurrency(fiatCurrency: number | string): LegacyFiatCurrency {
  const n = Number(fiatCurrency);
  if (Number.isInteger(n) && n >= 0 && n <= 7) return n as LegacyFiatCurrency;
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
};

export type PartialFxRates = {
  ethUsd?: bigint | null;
  eurUsd?: bigint | null;
  cnyUsd?: bigint | null;
  inrUsd?: bigint | null;
  brlUsd?: bigint | null;
  idrUsd?: bigint | null;
  audUsd?: bigint | null;
};

const FIAT_RATE_KEYS: Record<
  Exclude<LegacyFiatCurrencyCode, "USD" | "AED">,
  keyof PartialFxRates
> = {
  EUR: "eurUsd",
  CNY: "cnyUsd",
  INR: "inrUsd",
  BRL: "brlUsd",
  IDR: "idrUsd",
  AUD: "audUsd",
};

function parseRateField(raw: string | undefined): bigint | null {
  if (!raw?.trim()) return null;
  try {
    const v = BigInt(raw.trim());
    return v > 0n ? v : null;
  } catch {
    return null;
  }
}

/** Parse individual rate query params into a partial rates object. */
export function parseFxRatesFromQuery(params: {
  eurUsdRate?: string;
  ethUsdRate?: string;
  cnyUsdRate?: string;
  inrUsdRate?: string;
  brlUsdRate?: string;
  idrUsdRate?: string;
  audUsdRate?: string;
}): PartialFxRates {
  return {
    ethUsd: parseRateField(params.ethUsdRate),
    eurUsd: parseRateField(params.eurUsdRate),
    cnyUsd: parseRateField(params.cnyUsdRate),
    inrUsd: parseRateField(params.inrUsdRate),
    brlUsd: parseRateField(params.brlUsdRate),
    idrUsd: parseRateField(params.idrUsdRate),
    audUsd: parseRateField(params.audUsdRate),
  };
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
  };
}

/** USD per 1 unit of fiat at 1e8 scale. AED uses peg constant; USD returns identity scale. */
export function fiatUsdRate(
  code: LegacyFiatCurrencyCode,
  rates: PartialFxRates | null,
): bigint | null {
  if (code === "USD") return FIAT_SCALE;
  if (code === "AED") return AED_USD_PEG_1E8;
  const key = FIAT_RATE_KEYS[code];
  const rate = rates?.[key];
  return rate != null && rate > 0n ? rate : null;
}

/** Whether a live FX rate is required for price filter/sort in this display currency. */
export function rateRequiredForPriceCurrency(currency: PriceCurrency): boolean {
  if (currency === "USD" || currency === "AED") return false;
  return true;
}

/** Check whether required rates for filter/sort are available. */
export function ratesReadyForPriceCurrency(
  currency: PriceCurrency,
  rates: PartialFxRates | null,
): boolean {
  if (!rateRequiredForPriceCurrency(currency)) return true;
  if (currency === "ETH") return rates?.ethUsd != null;
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

  if (priceCurrency === "ETH") {
    if (rates?.ethUsd == null) return undefined;
    const ethWei = BigInt(Math.round(n * Number(ETH_SCALE)));
    return (ethWei * rates.ethUsd) / ETH_SCALE;
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
