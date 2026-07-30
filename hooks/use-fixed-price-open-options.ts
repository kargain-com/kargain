"use client";

import { useQuery } from "@tanstack/react-query";

import { getFixedPriceOpenOptions } from "@/app/actions/commerce-open-options";
import type { FixedPriceOpenOptions } from "@/lib/commerce/fixed-price-open-options";
import { deriveFixedPriceOpenOptions } from "@/lib/commerce/fixed-price-open-options";

export const fixedPriceOpenOptionsQueryKey = (chainId: number) =>
  ["commerce-open-options", chainId] as const;

const EMPTY_UNAVAILABLE: FixedPriceOpenOptions = deriveFixedPriceOpenOptions({
  modeAvailable: false,
  native: { label: "ETH", decimals: 18 },
  paymentTokens: [],
  currencyFeeds: [],
});

/**
 * Indexed FixedPrice open pairings for the sell form.
 * Fail-open to native-only + USD when Ponder is unreachable (mode still deployed).
 */
export function useFixedPriceOpenOptions(chainId: number | null | undefined) {
  const enabled = chainId != null && Number.isFinite(chainId);
  const query = useQuery({
    queryKey: fixedPriceOpenOptionsQueryKey(chainId ?? 0),
    queryFn: () => getFixedPriceOpenOptions(chainId!),
    enabled,
    staleTime: 30_000,
  });

  const options = query.data?.options ?? EMPTY_UNAVAILABLE;
  const pending = enabled && query.isPending;

  return {
    options,
    pending,
    ponderError: query.data?.ponderError,
    refetch: query.refetch,
  };
}
