import { FIAT_SCALE } from "@/lib/marketplace/price-normalize";

export const COINGECKO_FX_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd,eur";

export type CoinGeckoFxRates = {
  ethUsd: bigint | null;
  eurUsd: bigint | null;
};

type CoinGeckoResponse = {
  ethereum?: {
    usd?: number;
    eur?: number;
  };
};

function fiatPriceTo1e8(value: number): bigint | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  return BigInt(Math.round(value * Number(FIAT_SCALE)));
}

/** Parse CoinGecko ETH/USD and ETH/EUR into Chainlink-compatible 1e8 rates. */
export function parseCoinGeckoRates(json: CoinGeckoResponse): CoinGeckoFxRates {
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

export async function fetchCoinGeckoRates(): Promise<CoinGeckoFxRates> {
  try {
    const res = await fetch(COINGECKO_FX_URL);
    if (!res.ok) return { ethUsd: null, eurUsd: null };
    const json = (await res.json()) as CoinGeckoResponse;
    return parseCoinGeckoRates(json);
  } catch {
    return { ethUsd: null, eurUsd: null };
  }
}
