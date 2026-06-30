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

export function useMarketRates(): MarketRates {
  const {
    ethUsd: chainlinkEthUsd,
    eurUsd: chainlinkEurUsd,
    isLoading: chainlinkLoading,
  } = useChainlinkRates();

  const needsCoinGecko =
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

  const ethUsd = chainlinkEthUsd ?? coingeckoRates?.ethUsd ?? null;
  const eurUsd = chainlinkEurUsd ?? coingeckoRates?.eurUsd ?? null;
  const btcUsd = coingeckoRates?.btcUsd ?? null;
  const cnyUsd = coingeckoRates?.cnyUsd ?? null;
  const inrUsd = coingeckoRates?.inrUsd ?? null;
  const brlUsd = coingeckoRates?.brlUsd ?? null;
  const idrUsd = coingeckoRates?.idrUsd ?? null;
  const audUsd = coingeckoRates?.audUsd ?? null;
  const aedUsd = coingeckoRates?.aedUsd ?? null;
  const krwUsd = coingeckoRates?.krwUsd ?? null;
  const rubUsd = coingeckoRates?.rubUsd ?? null;
  const jpyUsd = coingeckoRates?.jpyUsd ?? null;
  const isLoading = chainlinkLoading || (needsCoinGecko && coingeckoLoading);

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
