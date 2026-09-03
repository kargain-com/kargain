"use client";

import { useActiveAccount, requireEvmSession } from "@/hooks/use-active-account";

import { useQuery } from "@tanstack/react-query";

import { getPendingClaims } from "@/app/actions/claims";
import { mapPendingClaimsResponse } from "@/lib/claims/map-pending-claim";

export function pendingClaimsQueryKey(address: string | undefined) {
  return ["pending-claims", address?.toLowerCase()] as const;
}

export function usePendingClaims() {
  const { account } = useActiveAccount();
  const evm = requireEvmSession(account);
  const address = evm.ok ? evm.address : undefined;
  const isConnected = evm.ok;

  const query = useQuery({
    queryKey: pendingClaimsQueryKey(address),
    queryFn: async () => {
      const res = await getPendingClaims(address!, 1, 100);
      return {
        claims: mapPendingClaimsResponse(res.claims),
        total: res.total,
        ponderError: res.ponderError ?? null,
      };
    },
    enabled: isConnected && Boolean(address),
    staleTime: 20_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  return {
    claims: query.data?.claims ?? [],
    total: query.data?.total ?? 0,
    ponderError: query.data?.ponderError ?? null,
    isLoading: query.isPending,
    refetch: query.refetch,
  };
}
