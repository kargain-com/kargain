"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { fetchCoinGeckoRates } from "@/lib/marketplace/coingecko-rates";
import type { PartialFxRates } from "@/lib/marketplace/price-normalize";
import { useChainlinkRates } from "@/lib/marketplace/use-chainlink-rates";

const COINGECKO_STALE_MS = 60_000;

/** Chainlink has no feeds for extended fiats or BTC on 84532 — always fetch from CoinGecko. */
const NEEDS_EXTENDED_FIAT_RATES = true;

export type MarketRates = PartialFxRates & {
  isLoading: boolean;
};

type UseMarketRatesOptions = {
  enabled?: boolean;
};

export function useMarketRates(options?: UseMarketRatesOptions): MarketRates {
  const enabled = options?.enabled ?? true;

  const {
    ethUsd: chainlinkEthUsd,
    eurUsd: chainlinkEurUsd,
    isLoading: chainlinkLoading,
  } = useChainlinkRates({ enabled });

  const needsCoinGecko =
    enabled &&
    !chainlinkLoading &&
    (chainlinkEthUsd == null ||
      chainlinkEurUsd == null ||
      NEEDS_EXTENDED_FIAT_RATES);

  const { data: coingeckoRates, isLoading: coingeckoLoading } = useQuery({
    queryKey: ["coingecko-fx-rates"],
    queryFn: fetchCoinGeckoRates,
    enabled: needsCoinGecko,
    staleTime: COINGECKO_STALE_MS,
  });

  const ethUsd = enabled ? (chainlinkEthUsd ?? coingeckoRates?.ethUsd ?? null) : null;
  const eurUsd = enabled ? (chainlinkEurUsd ?? coingeckoRates?.eurUsd ?? null) : null;
  const btcUsd = enabled ? (coingeckoRates?.btcUsd ?? null) : null;
  const cnyUsd = enabled ? (coingeckoRates?.cnyUsd ?? null) : null;
  const inrUsd = enabled ? (coingeckoRates?.inrUsd ?? null) : null;
  const brlUsd = enabled ? (coingeckoRates?.brlUsd ?? null) : null;
  const idrUsd = enabled ? (coingeckoRates?.idrUsd ?? null) : null;
  const audUsd = enabled ? (coingeckoRates?.audUsd ?? null) : null;
  const aedUsd = enabled ? (coingeckoRates?.aedUsd ?? null) : null;
  const krwUsd = enabled ? (coingeckoRates?.krwUsd ?? null) : null;
  const rubUsd = enabled ? (coingeckoRates?.rubUsd ?? null) : null;
  const jpyUsd = enabled ? (coingeckoRates?.jpyUsd ?? null) : null;
  const isLoading = enabled && (chainlinkLoading || (needsCoinGecko && coingeckoLoading));

  return useMemo(
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
      isLoading,
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
      isLoading,
      jpyUsd,
      krwUsd,
      rubUsd,
    ],
  );
}
