"use client";

import { useActiveAccount } from "@/hooks/use-active-account";

import { useQuery } from "@tanstack/react-query";

import { getPendingClaims } from "@/app/actions/claims";
import {
  pendingClaimsFactFromQueryResult,
  type PendingClaimsFact,
} from "@/lib/claims/pending-claims-fact";
import { mapPendingClaimsResponse } from "@/lib/claims/map-pending-claim";
import {
  admitSessionSurface,
  admitSurfaceEvmAddress,
  isSurfaceAdmissionAvailable,
} from "@/lib/web3/surface-admission";

export function pendingClaimsQueryKey(address: string | undefined) {
  return ["pending-claims", address?.toLowerCase()] as const;
}

export function usePendingClaims(): PendingClaimsFact & {
  isLoading: boolean;
  refetch: () => void;
} {
  const { account } = useActiveAccount();
  const admission = admitSessionSurface(account, "pending_claims");
  const address = admitSurfaceEvmAddress(admission);

  const query = useQuery({
    queryKey: pendingClaimsQueryKey(address),
    queryFn: async () => {
      const res = await getPendingClaims(address!, 1, 100);
      if (!res.ok) {
        return { ok: false as const, error: res.error };
      }
      return {
        ok: true as const,
        claims: mapPendingClaimsResponse(res.claims),
        total: res.total,
      };
    },
    enabled: address != null,
    staleTime: 20_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  const refetch = () => {
    void query.refetch();
  };

  if (!isSurfaceAdmissionAvailable(admission)) {
    return {
      status: "refused",
      refusal: admission,
      isLoading: false,
      refetch,
    };
  }

  const fact = pendingClaimsFactFromQueryResult({
    isError: query.isError,
    isPending: query.isPending,
    data: query.data,
  });
  return {
    ...fact,
    isLoading: fact.status === "pending",
    refetch,
  };
}
