"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { Address } from "viem";

import { getNostrPool } from "@/lib/nostr/nostr-client";
import {
  ownProfileNeedsReattestation,
  PROFILE_REATTESTATION_INVALIDATED,
} from "@/lib/nostr/resolve-attested-profile";

export function useOwnProfileNeedsReattestation(
  address: Address | undefined,
): { needsReattestation: boolean; loading: boolean } {
  const queryClient = useQueryClient();

  const { data, isPending, isFetching } = useQuery({
    queryKey: ["profile-reattestation", address],
    queryFn: () =>
      ownProfileNeedsReattestation(address!, { pool: getNostrPool() }),
    enabled: Boolean(address),
    staleTime: Number.POSITIVE_INFINITY,
  });

  useEffect(() => {
    if (!address) return;

    const onInvalidated = (event: Event) => {
      const detail = (event as CustomEvent<{ address?: string }>).detail;
      if (detail?.address !== address.toLowerCase()) return;
      void queryClient.invalidateQueries({
        queryKey: ["profile-reattestation", address],
      });
    };

    window.addEventListener(PROFILE_REATTESTATION_INVALIDATED, onInvalidated);
    return () => {
      window.removeEventListener(PROFILE_REATTESTATION_INVALIDATED, onInvalidated);
    };
  }, [address, queryClient]);

  return {
    needsReattestation: data === true,
    loading: Boolean(address) && (isPending || isFetching) && data === undefined,
  };
}
