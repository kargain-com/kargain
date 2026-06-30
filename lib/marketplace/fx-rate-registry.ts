import type {
  CryptoDisplayCurrency,
  LegacyFiatCurrencyCode,
} from "@/lib/marketplace/currency-code";

const ETH_DISPLAY_SCALE = 1_000_000_000_000_000_000n;
const BTC_DISPLAY_SCALE = 100_000_000n;

export type PartialFxRates = {
  ethUsd?: bigint | null;
  eurUsd?: bigint | null;
  btcUsd?: bigint | null;
  cnyUsd?: bigint | null;
  inrUsd?: bigint | null;
  brlUsd?: bigint | null;
  idrUsd?: bigint | null;
  audUsd?: bigint | null;
  aedUsd?: bigint | null;
  krwUsd?: bigint | null;
  rubUsd?: bigint | null;
  jpyUsd?: bigint | null;
};

/** Fiat codes sourced from CoinGecko exchange_rates (BTC-denominated). */
export const EXCHANGE_FIAT_ENTRIES = [
  { code: "CNY", coingeckoKey: "cny", rateField: "cnyUsd", queryParam: "cnyUsdRate" },
  { code: "INR", coingeckoKey: "inr", rateField: "inrUsd", queryParam: "inrUsdRate" },
  { code: "BRL", coingeckoKey: "brl", rateField: "brlUsd", queryParam: "brlUsdRate" },
  { code: "IDR", coingeckoKey: "idr", rateField: "idrUsd", queryParam: "idrUsdRate" },
  { code: "AUD", coingeckoKey: "aud", rateField: "audUsd", queryParam: "audUsdRate" },
  { code: "AED", coingeckoKey: "aed", rateField: "aedUsd", queryParam: "aedUsdRate" },
  { code: "KRW", coingeckoKey: "krw", rateField: "krwUsd", queryParam: "krwUsdRate" },
  { code: "RUB", coingeckoKey: "rub", rateField: "rubUsd", queryParam: "rubUsdRate" },
  { code: "JPY", coingeckoKey: "jpy", rateField: "jpyUsd", queryParam: "jpyUsdRate" },
] as const satisfies ReadonlyArray<{
  code: LegacyFiatCurrencyCode;
  coingeckoKey: string;
  rateField: keyof PartialFxRates;
  queryParam: string;
}>;

export type ExchangeFiatRateField = (typeof EXCHANGE_FIAT_ENTRIES)[number]["rateField"];

export const COINGECKO_EXCHANGE_FIAT_KEYS = EXCHANGE_FIAT_ENTRIES.map((e) => e.coingeckoKey);

export const FIAT_RATE_KEYS: Record<
  Exclude<LegacyFiatCurrencyCode, "USD">,
  keyof PartialFxRates
> = {
  EUR: "eurUsd",
  ...Object.fromEntries(EXCHANGE_FIAT_ENTRIES.map((e) => [e.code, e.rateField])) as Record<
    (typeof EXCHANGE_FIAT_ENTRIES)[number]["code"],
    ExchangeFiatRateField
  >,
};

export const CRYPTO_DISPLAY_CONFIG: Record<
  CryptoDisplayCurrency,
  {
    rateField: keyof PartialFxRates;
    queryParam: string;
    scale: bigint;
    suffix: string;
    selectorSymbol: string;
    fracDigits: number;
  }
> = {
  ETH: {
    rateField: "ethUsd",
    queryParam: "ethUsdRate",
    scale: ETH_DISPLAY_SCALE,
    suffix: "ETH",
    selectorSymbol: "Ξ",
    fracDigits: 4,
  },
  BTC: {
    rateField: "btcUsd",
    queryParam: "btcUsdRate",
    scale: BTC_DISPLAY_SCALE,
    suffix: "BTC",
    selectorSymbol: "₿",
    fracDigits: 4,
  },
};

export function createNullExchangeFiatRates(): Pick<PartialFxRates, ExchangeFiatRateField> {
  const result = {} as Pick<PartialFxRates, ExchangeFiatRateField>;
  for (const entry of EXCHANGE_FIAT_ENTRIES) {
    result[entry.rateField as ExchangeFiatRateField] = null;
  }
  return result;
}

export type MarketApiRates = {
  eurUsdRate?: string;
  ethUsdRate?: string;
  btcUsdRate?: string;
} & Partial<Record<(typeof EXCHANGE_FIAT_ENTRIES)[number]["queryParam"], string>>;

/** Build Ponder rate query params from live PartialFxRates. */
export function marketRatesToQueryParams(rates: PartialFxRates): MarketApiRates {
  const out: MarketApiRates = {};
  if (rates.eurUsd != null) out.eurUsdRate = rates.eurUsd.toString();
  if (rates.ethUsd != null) out.ethUsdRate = rates.ethUsd.toString();
  if (rates.btcUsd != null) out.btcUsdRate = rates.btcUsd.toString();
  for (const entry of EXCHANGE_FIAT_ENTRIES) {
    const value = rates[entry.rateField];
    if (value != null) {
      (out as Record<string, string>)[entry.queryParam] = value.toString();
    }
  }
  return out;
}

/** Parse rate query params into PartialFxRates (EUR/ETH/BTC + exchange fiats). */
export function parseFxRatesFromQueryParams(
  params: Record<string, string | undefined>,
): PartialFxRates {
  const parse = (raw: string | undefined): bigint | null => {
    if (!raw?.trim()) return null;
    try {
      const v = BigInt(raw.trim());
      return v > 0n ? v : null;
    } catch {
      return null;
    }
  };

  const result: PartialFxRates = {
    ethUsd: parse(params.ethUsdRate),
    eurUsd: parse(params.eurUsdRate),
    btcUsd: parse(params.btcUsdRate),
    ...createNullExchangeFiatRates(),
  };

  for (const entry of EXCHANGE_FIAT_ENTRIES) {
    const parsed = parse(params[entry.queryParam]);
    if (parsed != null) {
      result[entry.rateField] = parsed;
    }
  }

  return result;
}

/** Extract FX rate fields for filter/sort from a rates-bearing context. */
export function pickPartialFxRates(source: PartialFxRates): PartialFxRates {
  return {
    ethUsd: source.ethUsd,
    eurUsd: source.eurUsd,
    btcUsd: source.btcUsd,
    cnyUsd: source.cnyUsd,
    inrUsd: source.inrUsd,
    brlUsd: source.brlUsd,
    idrUsd: source.idrUsd,
    audUsd: source.audUsd,
    aedUsd: source.aedUsd,
    krwUsd: source.krwUsd,
    rubUsd: source.rubUsd,
    jpyUsd: source.jpyUsd,
  };
}
