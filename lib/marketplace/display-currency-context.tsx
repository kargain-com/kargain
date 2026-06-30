"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  DISPLAY_CURRENCIES,
  isCryptoDisplayCurrency,
  isDisplayCurrency,
  legacyFiatToCode,
  type DisplayCurrency,
  type LegacyFiatCurrency,
} from "@/lib/marketplace/currency-code";
import { CRYPTO_DISPLAY_CONFIG } from "@/lib/marketplace/fx-rate-registry";
import { fiatCurrencySymbol } from "@/lib/marketplace/fiat-format";
import {
  FIAT_SCALE,
  listingToUsd1e8,
  normalizeListingFiatCurrency,
  usd1e8ToFiat1e8,
  type PartialFxRates,
} from "@/lib/marketplace/price-normalize";
import { useMarketRates } from "@/lib/marketplace/use-market-rates";

export type { DisplayCurrency };

const STORAGE_KEY = "kargain_display_currency";

function formatFiat1e8WithSymbol(value: bigint, symbol: string): string {
  const neg = value < 0n;
  const v = neg ? -value : value;
  const whole = v / FIAT_SCALE;
  const fracRaw = v % FIAT_SCALE;
  let frac2 = (fracRaw + 500_000n) / 1_000_000n;
  let wholePart = whole;
  if (frac2 === 100n) {
    wholePart += 1n;
    frac2 = 0n;
  }
  const core = `${wholePart.toLocaleString("en-US")}.${frac2.toString().padStart(2, "0")}`;
  const prefix = symbol.length === 1 ? symbol : `${symbol} `;
  return `${prefix}${neg ? `-${core}` : core}`;
}

function formatCryptoUnits(units: bigint, suffix: string, fracDigits: number): string {
  const neg = units < 0n;
  const v = neg ? -units : units;
  const config = Object.values(CRYPTO_DISPLAY_CONFIG).find((c) => c.suffix === suffix);
  const scale = config?.scale ?? 1n;
  const whole = v / scale;
  const fracRaw = v % scale;
  const fracDivisor = 10n ** BigInt(fracDigits);
  const fracScale = scale / fracDivisor;
  let frac = fracScale > 0n ? (fracRaw + fracScale / 2n) / fracScale : 0n;
  let wholePart = whole;
  if (frac >= fracDivisor) {
    wholePart += 1n;
    frac = 0n;
  }
  const core = `${wholePart.toString()}.${frac.toString().padStart(fracDigits, "0")}`;
  return `${neg ? `-${core}` : core} ${suffix}`;
}

type DisplayCurrencyContextValue = PartialFxRates & {
  displayCurrency: DisplayCurrency;
  setDisplayCurrency: (currency: DisplayCurrency) => void;
  convertPrice: (fiatPrice1e8: bigint, fiatCurrency: LegacyFiatCurrency) => string;
  isRatesLoading: boolean;
};

const DisplayCurrencyContext = createContext<DisplayCurrencyContextValue | null>(null);

export function DisplayCurrencyProvider({ children }: { children: ReactNode }) {
  const [displayCurrency, setDisplayCurrencyState] = useState<DisplayCurrency>("USD");
  const marketRates = useMarketRates();

  const {
    ethUsd,
    eurUsd,
    btcUsd,
    cnyUsd,
    inrUsd,
    brlUsd,
    idrUsd,
    audUsd,
    aedUsd,
    krwUsd,
    rubUsd,
    jpyUsd,
    isLoading: isRatesLoading,
  } = marketRates;

  const rates: PartialFxRates = useMemo(
    () => ({
      ethUsd,
      eurUsd,
      btcUsd,
      cnyUsd,
      inrUsd,
      brlUsd,
      idrUsd,
      audUsd,
      aedUsd,
      krwUsd,
      rubUsd,
      jpyUsd,
    }),
    [
      aedUsd,
      audUsd,
      brlUsd,
      btcUsd,
      cnyUsd,
      ethUsd,
      eurUsd,
      idrUsd,
      inrUsd,
      jpyUsd,
      krwUsd,
      rubUsd,
    ],
  );

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && isDisplayCurrency(stored)) {
      setDisplayCurrencyState(stored);
    }
  }, []);

  const setDisplayCurrency = useCallback((currency: DisplayCurrency) => {
    setDisplayCurrencyState(currency);
    window.localStorage.setItem(STORAGE_KEY, currency);
  }, []);

  const convertPrice = useCallback(
    (fiatPrice1e8: bigint, fiatCurrency: LegacyFiatCurrency): string => {
      const listingCurrency = normalizeListingFiatCurrency(fiatCurrency);
      const listingCode = legacyFiatToCode(listingCurrency);

      if (isCryptoDisplayCurrency(displayCurrency)) {
        const config = CRYPTO_DISPLAY_CONFIG[displayCurrency];
        const cryptoRate = rates[config.rateField];
        if (cryptoRate == null || cryptoRate <= 0n) return "—";
        const usd1e8 = listingToUsd1e8(fiatPrice1e8, listingCurrency, rates);
        if (usd1e8 == null) return "—";
        const units = (usd1e8 * config.scale) / cryptoRate;
        return formatCryptoUnits(units, config.suffix, config.fracDigits);
      }

      const displayCode = displayCurrency;
      if (listingCode === displayCode) {
        const symbol = fiatCurrencySymbol(displayCode);
        return formatFiat1e8WithSymbol(fiatPrice1e8, symbol);
      }

      const usd1e8 = listingToUsd1e8(fiatPrice1e8, listingCurrency, rates);
      if (usd1e8 == null) return "—";

      const display1e8 = usd1e8ToFiat1e8(usd1e8, displayCode, rates);
      if (display1e8 == null) return "—";

      const symbol = fiatCurrencySymbol(displayCode);
      return formatFiat1e8WithSymbol(display1e8, symbol);
    },
    [displayCurrency, rates],
  );

  const value = useMemo(
    () => ({
      displayCurrency,
      setDisplayCurrency,
      convertPrice,
      isRatesLoading,
      ...rates,
    }),
    [convertPrice, displayCurrency, isRatesLoading, rates, setDisplayCurrency],
  );

  return (
    <DisplayCurrencyContext.Provider value={value}>{children}</DisplayCurrencyContext.Provider>
  );
}

export function useDisplayCurrency(): DisplayCurrencyContextValue {
  const ctx = useContext(DisplayCurrencyContext);
  if (!ctx) {
    throw new Error("useDisplayCurrency must be used within DisplayCurrencyProvider");
  }
  return ctx;
}

export { DISPLAY_CURRENCIES };
