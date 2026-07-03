"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";

type MarketRatesRequestContextValue = {
  requestRates: () => () => void;
};

const MarketRatesRequestContext = createContext<MarketRatesRequestContextValue | null>(null);

export function MarketRatesRequestProvider({
  requestRates,
  children,
}: {
  requestRates: () => () => void;
  children: ReactNode;
}) {
  return (
    <MarketRatesRequestContext.Provider value={{ requestRates }}>
      {children}
    </MarketRatesRequestContext.Provider>
  );
}

export function useMarketRatesRequest(active: boolean) {
  const ctx = useContext(MarketRatesRequestContext);
  if (!ctx) {
    throw new Error("useMarketRatesRequest must be used within DisplayCurrencyProvider");
  }

  useEffect(() => {
    if (!active) return;
    return ctx.requestRates();
  }, [active, ctx]);
}
