import { FIAT_SCALE } from "@/lib/marketplace/price-normalize";

export const COINGECKO_FX_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd,eur";

export const COINGECKO_EXCHANGE_RATES_URL =
  "https://api.coingecko.com/api/v3/exchange_rates";

export type CoinGeckoFxRates = {
  ethUsd: bigint | null;
  eurUsd: bigint | null;
  cnyUsd: bigint | null;
  inrUsd: bigint | null;
  brlUsd: bigint | null;
  idrUsd: bigint | null;
  audUsd: bigint | null;
};

type CoinGeckoEthResponse = {
  ethereum?: {
    usd?: number;
    eur?: number;
  };
};

type CoinGeckoExchangeRatesResponse = {
  rates?: Record<string, { value?: number }>;
};

const EXCHANGE_RATE_FIATS = ["cny", "inr", "brl", "idr", "aud"] as const;

function fiatPriceTo1e8(value: number): bigint | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  return BigInt(Math.round(value * Number(FIAT_SCALE)));
}

/** Parse CoinGecko ETH/USD and ETH/EUR into Chainlink-compatible 1e8 rates. */
export function parseCoinGeckoRates(json: CoinGeckoEthResponse): Pick<
  CoinGeckoFxRates,
  "ethUsd" | "eurUsd"
> {
  const eth = json.ethereum;
  if (!eth) return { ethUsd: null, eurUsd: null };

  const ethUsd1e8 = eth.usd != null ? fiatPriceTo1e8(eth.usd) : null;
  const ethEur1e8 = eth.eur != null ? fiatPriceTo1e8(eth.eur) : null;

  let eurUsd1e8: bigint | null = null;
  if (ethUsd1e8 != null && ethEur1e8 != null && ethEur1e8 > 0n) {
    eurUsd1e8 = (ethUsd1e8 * FIAT_SCALE) / ethEur1e8;
  }

  return {
    ethUsd: ethUsd1e8,
    eurUsd: eurUsd1e8 != null && eurUsd1e8 > 0n ? eurUsd1e8 : null,
  };
}

/** Parse CoinGecko exchange_rates BTC-denominated fiats into USD-per-unit 1e8 rates. */
export function parseCoinGeckoExchangeRates(
  json: CoinGeckoExchangeRatesResponse,
): Pick<CoinGeckoFxRates, "cnyUsd" | "inrUsd" | "brlUsd" | "idrUsd" | "audUsd"> {
  const rates = json.rates;
  const usdPerBtc = rates?.usd?.value;
  if (usdPerBtc == null || !Number.isFinite(usdPerBtc) || usdPerBtc <= 0) {
    return { cnyUsd: null, inrUsd: null, brlUsd: null, idrUsd: null, audUsd: null };
  }

  const result: Pick<
    CoinGeckoFxRates,
    "cnyUsd" | "inrUsd" | "brlUsd" | "idrUsd" | "audUsd"
  > = {
    cnyUsd: null,
    inrUsd: null,
    brlUsd: null,
    idrUsd: null,
    audUsd: null,
  };

  for (const fiat of EXCHANGE_RATE_FIATS) {
    const fiatPerBtc = rates?.[fiat]?.value;
    if (fiatPerBtc == null || !Number.isFinite(fiatPerBtc) || fiatPerBtc <= 0) continue;
    const usdPerUnit = usdPerBtc / fiatPerBtc;
    const key = `${fiat}Usd` as keyof typeof result;
    result[key] = fiatPriceTo1e8(usdPerUnit);
  }

  return result;
}

async function fetchCoinGeckoEthRates(): Promise<Pick<CoinGeckoFxRates, "ethUsd" | "eurUsd">> {
  try {
    const res = await fetch(COINGECKO_FX_URL);
    if (!res.ok) return { ethUsd: null, eurUsd: null };
    const json = (await res.json()) as CoinGeckoEthResponse;
    return parseCoinGeckoRates(json);
  } catch {
    return { ethUsd: null, eurUsd: null };
  }
}

async function fetchCoinGeckoExchangeRates(): Promise<
  Pick<CoinGeckoFxRates, "cnyUsd" | "inrUsd" | "brlUsd" | "idrUsd" | "audUsd">
> {
  try {
    const res = await fetch(COINGECKO_EXCHANGE_RATES_URL);
    if (!res.ok) return { cnyUsd: null, inrUsd: null, brlUsd: null, idrUsd: null, audUsd: null };
    const json = (await res.json()) as CoinGeckoExchangeRatesResponse;
    return parseCoinGeckoExchangeRates(json);
  } catch {
    return { cnyUsd: null, inrUsd: null, brlUsd: null, idrUsd: null, audUsd: null };
  }
}

export async function fetchCoinGeckoRates(): Promise<CoinGeckoFxRates> {
  const [ethRates, fiatRates] = await Promise.all([
    fetchCoinGeckoEthRates(),
    fetchCoinGeckoExchangeRates(),
  ]);
  return { ...ethRates, ...fiatRates };
}
