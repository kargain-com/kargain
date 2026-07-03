"use client";

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";

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
  const value = useMemo(() => ({ requestRates }), [requestRates]);

  return (
    <MarketRatesRequestContext.Provider value={value}>{children}</MarketRatesRequestContext.Provider>
  );
}

export function useMarketRatesRequest(active: boolean) {
  const ctx = useContext(MarketRatesRequestContext);
  if (!ctx) {
    throw new Error("useMarketRatesRequest must be used within MarketRatesRequestProvider");
  }

  const { requestRates } = ctx;

  useEffect(() => {
    if (!active) return;
    return requestRates();
  }, [active, requestRates]);
}
