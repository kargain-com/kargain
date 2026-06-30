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
  isDisplayCurrency,
  legacyFiatToCode,
  type DisplayCurrency,
  type LegacyFiatCurrency,
} from "@/lib/marketplace/currency-code";
import { fiatCurrencySymbol } from "@/lib/marketplace/fiat-format";
import {
  ETH_SCALE,
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

function formatEthWei(ethWei: bigint): string {
  const neg = ethWei < 0n;
  const v = neg ? -ethWei : ethWei;
  const whole = v / ETH_SCALE;
  const fracRaw = v % ETH_SCALE;
  let frac4 = (fracRaw + 5_000_000_000_000_000n) / 10_000_000_000_000_000n;
  let wholePart = whole;
  if (frac4 === 10_000n) {
    wholePart += 1n;
    frac4 = 0n;
  }
  const core = `${wholePart.toString()}.${frac4.toString().padStart(4, "0")}`;
  return `${neg ? `-${core}` : core} ETH`;
}

type DisplayCurrencyContextValue = {
  displayCurrency: DisplayCurrency;
  setDisplayCurrency: (currency: DisplayCurrency) => void;
  convertPrice: (fiatPrice1e8: bigint, fiatCurrency: LegacyFiatCurrency) => string;
  isRatesLoading: boolean;
  ethUsd: bigint | null;
  eurUsd: bigint | null;
  cnyUsd: bigint | null;
  inrUsd: bigint | null;
  brlUsd: bigint | null;
  idrUsd: bigint | null;
  audUsd: bigint | null;
  aedUsd: bigint;
};

const DisplayCurrencyContext = createContext<DisplayCurrencyContextValue | null>(null);

export function DisplayCurrencyProvider({ children }: { children: ReactNode }) {
  const [displayCurrency, setDisplayCurrencyState] = useState<DisplayCurrency>("USD");
  const {
    ethUsd,
    eurUsd,
    cnyUsd,
    inrUsd,
    brlUsd,
    idrUsd,
    audUsd,
    aedUsd,
    isLoading: isRatesLoading,
  } = useMarketRates();

  const rates: PartialFxRates = useMemo(
    () => ({
      ethUsd,
      eurUsd,
      cnyUsd,
      inrUsd,
      brlUsd,
      idrUsd,
      audUsd,
      aedUsd,
    }),
    [aedUsd, audUsd, brlUsd, cnyUsd, ethUsd, eurUsd, idrUsd, inrUsd],
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

      if (displayCurrency === "ETH") {
        if (ethUsd == null) return "—";
        const usd1e8 = listingToUsd1e8(fiatPrice1e8, listingCurrency, rates);
        if (usd1e8 == null) return "—";
        const ethWei = (usd1e8 * ETH_SCALE) / ethUsd;
        return formatEthWei(ethWei);
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
    [displayCurrency, ethUsd, rates],
  );

  const value = useMemo(
    () => ({
      displayCurrency,
      setDisplayCurrency,
      convertPrice,
      isRatesLoading,
      ethUsd,
      eurUsd,
      cnyUsd,
      inrUsd,
      brlUsd,
      idrUsd,
      audUsd,
      aedUsd,
    }),
    [
      aedUsd,
      audUsd,
      brlUsd,
      cnyUsd,
      convertPrice,
      displayCurrency,
      ethUsd,
      eurUsd,
      idrUsd,
      inrUsd,
      isRatesLoading,
      setDisplayCurrency,
    ],
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
