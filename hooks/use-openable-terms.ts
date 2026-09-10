"use client";

import { useQuery } from "@tanstack/react-query";

import { getOpenableTerms } from "@/app/actions/commerce-open-options";
import type { CommerceMode } from "@/lib/commerce/mode";
import {
  deriveOpenableTerms,
  type OpenableTerms,
} from "@/lib/commerce/openable-terms";
import {
  commercialActive,
  nativeUnitOf,
} from "@/lib/web3/commercial-active";
import { indexerQueryKey } from "@/lib/web3/indexer-query-keys";

export const openableTermsQueryKey = (
  chainId: number,
  mode: CommerceMode,
) => indexerQueryKey("commerce-open-options", chainId, mode);

function nativePairing(chainId: number): { label: string; decimals: number } | null {
  const stack = commercialActive(chainId);
  if (stack == null) return null;
  const u = nativeUnitOf(stack);
  return { label: u.symbol, decimals: u.decimals };
}

const EMPTY_UNAVAILABLE = (mode: CommerceMode): OpenableTerms =>
  deriveOpenableTerms({
    mode,
    modeAvailable: false,
    configResolved: true,
    // Placeholder only — mode unavailable so pairings are never offered.
    native: { label: "—", decimals: 0 },
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
  const pairing = enabled ? nativePairing(chainId!) : null;
  const query = useQuery({
    queryKey: openableTermsQueryKey(chainId ?? 0, mode),
    queryFn: () => getOpenableTerms(chainId!, mode),
    enabled: enabled && pairing != null,
    staleTime: 30_000,
  });

  const options =
    query.data?.options ??
    (enabled && pairing != null
      ? deriveOpenableTerms({
          mode,
          modeAvailable: true,
          configResolved: false,
          native: pairing,
          paymentTokens: [],
          currencyFeeds: [],
        })
      : EMPTY_UNAVAILABLE(mode));
  const pending = enabled && pairing != null && query.isPending;

  return {
    options,
    pending,
    ponderError: query.data?.ponderError,
    refetch: query.refetch,
  };
}
