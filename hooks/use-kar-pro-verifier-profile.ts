"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

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
  const nullFetchCountRef = useRef(0);

  useEffect(() => {
    nullFetchCountRef.current = 0;
  }, [address]);

  const ponderQuery = useQuery({
    queryKey: ["kar-pro-verifier", address],
    queryFn: async () => {
      const profile = await fetchKarProVerifierProfile(address!, { fresh: true });
      if (!profile) {
        nullFetchCountRef.current += 1;
      } else {
        nullFetchCountRef.current = 0;
      }
      return profile;
    },
    enabled,
    refetchInterval: (query) =>
      shouldPollKarProVerifierProfile(
        query.state.data,
        nullFetchCountRef.current,
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
    nullFetchCountRef.current >= KAR_PRO_VERIFIER_POLL_MAX_ATTEMPTS;

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
