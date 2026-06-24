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
  ETH_SCALE,
  FIAT_SCALE,
  listingToEur1e8,
  listingToUsd1e8,
  normalizeListingFiatCurrency,
  type PriceCurrency,
} from "@/lib/marketplace/price-normalize";
import { useChainlinkRates } from "@/lib/marketplace/use-chainlink-rates";

export type DisplayCurrency = PriceCurrency;

const STORAGE_KEY = "kargain_display_currency";

const DISPLAY_CURRENCIES: DisplayCurrency[] = ["USD", "EUR", "ETH"];

function isDisplayCurrency(value: string): value is DisplayCurrency {
  return DISPLAY_CURRENCIES.includes(value as DisplayCurrency);
}

function formatFiat1e8(value: bigint, prefix: "$" | "€"): string {
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
  convertPrice: (fiatPrice1e8: bigint, fiatCurrency: 0 | 1) => string;
  isRatesLoading: boolean;
  ethUsd: bigint | null;
  eurUsd: bigint | null;
};

const DisplayCurrencyContext = createContext<DisplayCurrencyContextValue | null>(null);

export function DisplayCurrencyProvider({ children }: { children: ReactNode }) {
  const [displayCurrency, setDisplayCurrencyState] = useState<DisplayCurrency>("USD");
  const { ethUsd, eurUsd, isLoading: isRatesLoading } = useChainlinkRates();

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
    (fiatPrice1e8: bigint, fiatCurrency: 0 | 1): string => {
      const listingCurrency = normalizeListingFiatCurrency(fiatCurrency);

      if (displayCurrency === "USD") {
        if (listingCurrency === 0) {
          return formatFiat1e8(fiatPrice1e8, "$");
        }
        if (eurUsd == null) return "—";
        const usd1e8 = listingToUsd1e8(fiatPrice1e8, listingCurrency, eurUsd);
        return formatFiat1e8(usd1e8, "$");
      }

      if (displayCurrency === "EUR") {
        if (listingCurrency === 1) {
          return formatFiat1e8(fiatPrice1e8, "€");
        }
        if (eurUsd == null) return "—";
        const eur1e8 = listingToEur1e8(fiatPrice1e8, listingCurrency, eurUsd);
        return formatFiat1e8(eur1e8, "€");
      }

      if (ethUsd == null || eurUsd == null) return "—";
      const usd1e8 = listingToUsd1e8(fiatPrice1e8, listingCurrency, eurUsd);
      const ethWei = (usd1e8 * ETH_SCALE) / ethUsd;
      return formatEthWei(ethWei);
    },
    [displayCurrency, ethUsd, eurUsd],
  );

  const value = useMemo(
    () => ({
      displayCurrency,
      setDisplayCurrency,
      convertPrice,
      isRatesLoading,
      ethUsd,
      eurUsd,
    }),
    [convertPrice, displayCurrency, ethUsd, eurUsd, isRatesLoading, setDisplayCurrency],
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
