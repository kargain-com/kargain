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
  syncWhileMissing?: boolean;
};

export function useKarProVerifierProfile(
  address: `0x${string}` | undefined,
  options: UseKarProVerifierProfileOptions,
) {
  const { isActiveVerifier, syncWhileMissing = false } = options;
  const enabled = Boolean(address && isActiveVerifier);
  const pollKey = address ?? "";
  const [nullFetchCount, setNullFetchCount] = useState(0);
  const [trackedPollKey, setTrackedPollKey] = useState(pollKey);
  if (pollKey !== trackedPollKey) {
    setTrackedPollKey(pollKey);
    setNullFetchCount(0);
  }
  const failureCount = pollKey === trackedPollKey ? nullFetchCount : 0;

  const ponderQuery = useQuery({
    queryKey: ["kar-pro-verifier", address],
    queryFn: async () => {
      const profile = await fetchKarProVerifierProfile(address!, { fresh: true });
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

  const chainQuery = useKarProOnChainProfile(address, enabled);

  const ponderProfile = ponderQuery.data ?? null;
  const chainProfile = chainQuery.profile;
  const profile = ponderProfile ?? chainProfile ?? null;

  const pollExhausted =
    syncWhileMissing &&
    enabled &&
    !ponderProfile &&
    failureCount >= KAR_PRO_VERIFIER_POLL_MAX_ATTEMPTS;

  const isLoading =
    enabled &&
    !profile &&
    (ponderQuery.isPending || chainQuery.isLoading) &&
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
