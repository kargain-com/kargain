"use client";

import { useMemo } from "react";
import { useReadContract } from "wagmi";

import {
  commerceModeAbi,
  commerceModeAddress,
  type CommerceMode,
} from "@/lib/commerce/mode";
import { wagmiChainId } from "@/lib/web3/supported-chains";

const STALE_MS = 15_000;

/**
 * Chain-sourced `paused()` for one mode. Never reads the indexer — a lagging
 * projection that says bidding is open into a paused contract is worse than silence.
 */
export function useCommerceModePaused(input: {
  mode: CommerceMode;
  chainId: number;
  enabled?: boolean;
}): {
  paused: boolean | undefined;
  isPending: boolean;
  refetch: () => void;
} {
  const { mode, chainId, enabled = true } = input;
  const address = commerceModeAddress(mode, chainId);
  const wc = wagmiChainId(chainId);
  const readsEnabled = Boolean(enabled && address);

  const { data, isPending, refetch } = useReadContract({
    address,
    abi: commerceModeAbi(mode),
    functionName: "paused",
    chainId: wc,
    query: { enabled: readsEnabled, staleTime: STALE_MS },
  });

  return {
    paused: !readsEnabled || data == null ? undefined : data === true,
    isPending: readsEnabled && isPending,
    refetch,
  };
}
