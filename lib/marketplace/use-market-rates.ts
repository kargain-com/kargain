"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { fetchCoinGeckoRates } from "@/lib/marketplace/coingecko-rates";
import { AED_USD_PEG_1E8 } from "@/lib/marketplace/price-normalize";
import { useChainlinkRates } from "@/lib/marketplace/use-chainlink-rates";

const COINGECKO_STALE_MS = 60_000;

/** Chainlink has no feeds for CNY/INR/BRL/IDR/AUD/AED on 84532 — always fetch from CoinGecko. */
const NEEDS_EXTENDED_FIAT_RATES = true;

export function useMarketRates(): {
  ethUsd: bigint | null;
  eurUsd: bigint | null;
  cnyUsd: bigint | null;
  inrUsd: bigint | null;
  brlUsd: bigint | null;
  idrUsd: bigint | null;
  audUsd: bigint | null;
  aedUsd: bigint;
  isLoading: boolean;
} {
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
  const cnyUsd = coingeckoRates?.cnyUsd ?? null;
  const inrUsd = coingeckoRates?.inrUsd ?? null;
  const brlUsd = coingeckoRates?.brlUsd ?? null;
  const idrUsd = coingeckoRates?.idrUsd ?? null;
  const audUsd = coingeckoRates?.audUsd ?? null;
  const aedUsd = coingeckoRates?.aedUsd ?? AED_USD_PEG_1E8;
  const isLoading = chainlinkLoading || (needsCoinGecko && coingeckoLoading);

  return useMemo(
    () => ({
      ethUsd,
      eurUsd,
      cnyUsd,
      inrUsd,
      brlUsd,
      idrUsd,
      audUsd,
      aedUsd,
      isLoading,
    }),
    [aedUsd, audUsd, brlUsd, cnyUsd, ethUsd, eurUsd, idrUsd, inrUsd, isLoading],
  );
}
