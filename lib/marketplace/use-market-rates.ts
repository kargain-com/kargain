"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { fetchCoinGeckoRates } from "@/lib/marketplace/coingecko-rates";
import { useChainlinkRates } from "@/lib/marketplace/use-chainlink-rates";

const COINGECKO_STALE_MS = 60_000;

export function useMarketRates(): {
  ethUsd: bigint | null;
  eurUsd: bigint | null;
  isLoading: boolean;
} {
  const {
    ethUsd: chainlinkEthUsd,
    eurUsd: chainlinkEurUsd,
    isLoading: chainlinkLoading,
  } = useChainlinkRates();

  const needsCoinGecko =
    !chainlinkLoading && (chainlinkEthUsd == null || chainlinkEurUsd == null);

  const { data: coingeckoRates, isLoading: coingeckoLoading } = useQuery({
    queryKey: ["coingecko-fx-rates"],
    queryFn: fetchCoinGeckoRates,
    enabled: needsCoinGecko,
    staleTime: COINGECKO_STALE_MS,
  });

  const ethUsd = chainlinkEthUsd ?? coingeckoRates?.ethUsd ?? null;
  const eurUsd = chainlinkEurUsd ?? coingeckoRates?.eurUsd ?? null;
  const isLoading = chainlinkLoading || (needsCoinGecko && coingeckoLoading);

  return useMemo(
    () => ({ ethUsd, eurUsd, isLoading }),
    [ethUsd, eurUsd, isLoading],
  );
}
