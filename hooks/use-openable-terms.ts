"use client";

import { useQuery } from "@tanstack/react-query";

import { getOpenableTerms } from "@/app/actions/commerce-open-options";
import type { CommerceMode } from "@/lib/commerce/mode";
import {
  deriveOpenableTerms,
  type OpenableTerms,
} from "@/lib/commerce/openable-terms";
import { indexerQueryKey } from "@/lib/web3/indexer-query-keys";

export const openableTermsQueryKey = (
  chainId: number,
  mode: CommerceMode,
) => indexerQueryKey("commerce-open-options", chainId, mode);

const EMPTY_UNAVAILABLE = (mode: CommerceMode): OpenableTerms =>
  deriveOpenableTerms({
    mode,
    modeAvailable: false,
    configResolved: true,
    native: { label: "ETH", decimals: 18 },
    paymentTokens: [],
    currencyFeeds: [],
  });

/**
 * Indexed openable / grantable terms for a selling mode.
 * Fail closed while pending or when Ponder is unreachable.
 */
export function useOpenableTerms(
  chainId: number | null | undefined,
  mode: CommerceMode,
) {
  const enabled = chainId != null && Number.isFinite(chainId);
  const query = useQuery({
    queryKey: openableTermsQueryKey(chainId ?? 0, mode),
    queryFn: () => getOpenableTerms(chainId!, mode),
    enabled,
    staleTime: 30_000,
  });

  const options =
    query.data?.options ??
    (enabled
      ? deriveOpenableTerms({
          mode,
          modeAvailable: true,
          configResolved: false,
          native: { label: "ETH", decimals: 18 },
          paymentTokens: [],
          currencyFeeds: [],
        })
      : EMPTY_UNAVAILABLE(mode));
  const pending = enabled && query.isPending;

  return {
    options,
    pending,
    ponderError: query.data?.ponderError,
    refetch: query.refetch,
  };
}
