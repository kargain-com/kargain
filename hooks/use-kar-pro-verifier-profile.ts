"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { fetchKarProVerifierProfile } from "@/app/actions/kar-pro-verifier";
import { useKarProOnChainProfile } from "@/hooks/use-kar-pro-on-chain-profile";
import {
  KAR_PRO_VERIFIER_POLL_MAX_ATTEMPTS,
  shouldPollKarProVerifierProfile,
} from "@/lib/kar-pro/kar-pro-verifier-profile";

type UseKarProVerifierProfileOptions = {
  isActiveVerifier: boolean;
  /** Commercial chain for on-chain ProPass fallback; null disables chain reads. */
  chainId: number | null;
  syncWhileMissing?: boolean;
};

export function useKarProVerifierProfile(
  address: `0x${string}` | undefined,
  options: UseKarProVerifierProfileOptions,
) {
  const { isActiveVerifier, chainId, syncWhileMissing = false } = options;
  const enabled = Boolean(address && isActiveVerifier);
  const chainReadsEnabled = enabled && chainId != null;
  const pollKey = address ?? "";
  const [nullFetchCount, setNullFetchCount] = useState(0);
  const [trackedPollKey, setTrackedPollKey] = useState(pollKey);
  if (pollKey !== trackedPollKey) {
    setTrackedPollKey(pollKey);
    setNullFetchCount(0);
  }
  const failureCount = pollKey === trackedPollKey ? nullFetchCount : 0;

  const ponderQuery = useQuery({
    queryKey: ["kar-pro-verifier", address, chainId],
    queryFn: async () => {
      const profile = await fetchKarProVerifierProfile(address!);
      setNullFetchCount((prev) => (profile ? 0 : prev + 1));
      return profile;
    },
    enabled,
    refetchInterval: (query) =>
      shouldPollKarProVerifierProfile(
        query.state.data,
        failureCount,
        syncWhileMissing,
      ),
    refetchIntervalInBackground: false,
  });

  const chainQuery = useKarProOnChainProfile(
    address,
    chainReadsEnabled,
    chainId ?? undefined,
  );

  const ponderProfile = ponderQuery.data ?? null;
  const chainProfile = chainReadsEnabled ? chainQuery.profile : null;
  const profile = ponderProfile ?? chainProfile ?? null;

  const pollExhausted =
    syncWhileMissing &&
    enabled &&
    !ponderProfile &&
    failureCount >= KAR_PRO_VERIFIER_POLL_MAX_ATTEMPTS;

  const isLoading =
    enabled &&
    !profile &&
    (ponderQuery.isPending || (chainReadsEnabled && chainQuery.isLoading)) &&
    !pollExhausted;

  const isSyncing = enabled && Boolean(chainProfile) && !ponderProfile;

  return {
    profile,
    isLoading,
    isSyncing,
    pollExhausted,
    refetch: ponderQuery.refetch,
  };
}
