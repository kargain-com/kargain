"use client";

import { useQuery } from "@tanstack/react-query";

import { getAccountObligations } from "@/app/actions/commerce-obligations";
import {
  deriveOutstandingObligations,
  outstandingCount,
  type OutstandingObligationsResult,
} from "@/lib/obligation";
import { useNow } from "@/hooks/use-now";

export function outstandingObligationsQueryKey(address: string | undefined) {
  return ["outstanding-obligations", address?.toLowerCase() ?? ""] as const;
}

export function useOutstandingObligations(input: {
  address: string | undefined;
  isActiveVerifier: boolean | undefined;
  enabled?: boolean;
}) {
  const { address, isActiveVerifier, enabled = true } = input;
  const nowSec = useNow(15);

  const query = useQuery({
    queryKey: outstandingObligationsQueryKey(address),
    queryFn: async () => {
      if (!address) {
        return {
          unresolved: true,
          consignments: [],
          holds: [],
          bids: [],
          challenges: [],
          passports: [],
          modes: [],
        } as const;
      }
      const result = await getAccountObligations(address);
      return result.facts;
    },
    enabled: Boolean(enabled && address),
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  const derived: OutstandingObligationsResult = deriveOutstandingObligations(
    query.data ?? {
      unresolved: true,
      consignments: [],
      holds: [],
      bids: [],
      challenges: [],
      passports: [],
      modes: [],
    },
    {
      address,
      nowSec,
      isActiveVerifier,
    },
  );

  return {
    ...query,
    nowSec,
    derived,
    count: outstandingCount(derived),
  };
}
