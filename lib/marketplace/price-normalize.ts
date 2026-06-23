export const FIAT_SCALE = 100_000_000n;
export const ETH_SCALE = 1_000_000_000_000_000_000n;

export type PriceCurrency = "USD" | "EUR" | "ETH";

const PRICE_CURRENCIES: PriceCurrency[] = ["USD", "EUR", "ETH"];

export function isPriceCurrency(value: string): value is PriceCurrency {
  return PRICE_CURRENCIES.includes(value as PriceCurrency);
}

export type FxRates = {
  eurUsd: bigint;
  ethUsd: bigint;
};

export function parseFxRates(
  eurUsdRate?: string,
  ethUsdRate?: string,
): FxRates | null {
  if (!eurUsdRate?.trim() || !ethUsdRate?.trim()) return null;
  try {
    const eurUsd = BigInt(eurUsdRate.trim());
    const ethUsd = BigInt(ethUsdRate.trim());
    if (eurUsd <= 0n || ethUsd <= 0n) return null;
    return { eurUsd, ethUsd };
  } catch {
    return null;
  }
}

/** Normalize on-chain listing price to USD 1e8. */
export function listingToUsd1e8(
  fiatPrice1e8: bigint,
  fiatCurrency: 0 | 1,
  eurUsd: bigint,
): bigint {
  if (fiatCurrency === 0) return fiatPrice1e8;
  return (fiatPrice1e8 * eurUsd) / FIAT_SCALE;
}

/** Normalize on-chain listing price to EUR 1e8. */
export function listingToEur1e8(
  fiatPrice1e8: bigint,
  fiatCurrency: 0 | 1,
  eurUsd: bigint,
): bigint {
  if (fiatCurrency === 1) return fiatPrice1e8;
  return (fiatPrice1e8 * FIAT_SCALE) / eurUsd;
}

/** Convert user-entered filter amount to USD 1e8 for comparison. */
export function displayAmountToUsd1e8(
  amount: string,
  priceCurrency: PriceCurrency,
  rates: FxRates | null,
): bigint | undefined {
  const trimmed = amount.trim();
  if (!trimmed) return undefined;
  const n = Number.parseFloat(trimmed);
  if (!Number.isFinite(n) || n < 0) return undefined;

  if (priceCurrency === "USD") {
    return BigInt(Math.round(n * Number(FIAT_SCALE)));
  }

  if (priceCurrency === "EUR") {
    if (rates == null) return undefined;
    const eur1e8 = BigInt(Math.round(n * Number(FIAT_SCALE)));
    return listingToUsd1e8(eur1e8, 1, rates.eurUsd);
  }

  if (rates == null) return undefined;
  const ethWei = BigInt(Math.round(n * Number(ETH_SCALE)));
  return (ethWei * rates.ethUsd) / ETH_SCALE;
}

/** USD 1e8 → ETH display number (for facet placeholders). */
export function fiat1e8ToEthWei(usd1e8: bigint, ethUsd: bigint): number {
  const ethWei = (usd1e8 * ETH_SCALE) / ethUsd;
  return Number(ethWei) / Number(ETH_SCALE);
}
