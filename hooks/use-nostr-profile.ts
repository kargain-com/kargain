"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { type Address } from "viem";

import { fetchNostrProfile, type NostrProfileData } from "@/lib/nostr/profile";

export interface UseNostrProfileReturn {
  profile: NostrProfileData | null;
  loading: boolean;
  error: boolean;
  refetch: () => void;
}

const noop = () => {};

type UseNostrProfileOptions = {
  enabled?: boolean;
};

export function useNostrProfile(
  walletAddress: Address | undefined,
  initialProfile?: NostrProfileData | null,
  options?: UseNostrProfileOptions,
): UseNostrProfileReturn {
  const serverPrefetched = initialProfile !== undefined;
  const queryEnabled = Boolean(walletAddress) && (options?.enabled ?? true);

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["nostr-profile", walletAddress],
    queryFn: () => fetchNostrProfile(walletAddress!),
    enabled: queryEnabled,
    initialData: serverPrefetched ? (initialProfile ?? undefined) : undefined,
    staleTime: serverPrefetched ? 5 * 60 * 1000 : 60 * 1000,
    refetchOnMount: !serverPrefetched,
  });

  const refetchProfile = useCallback(() => {
    void refetch();
  }, [refetch]);

  if (!walletAddress) {
    return { profile: null, loading: false, error: false, refetch: noop };
  }

  return {
    profile: data ?? null,
    loading: isPending && data == null,
    error: isError,
    refetch: refetchProfile,
  };
}
