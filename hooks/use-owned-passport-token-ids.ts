"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";

import { fetchOwnedPassportTokenIds } from "@/app/actions/notifications";

export function useOwnedPassportTokenIds(): string[] {
  const { isConnected, address } = useAccount();

  const { data } = useQuery({
    queryKey: ["owned-passport-token-ids", address],
    queryFn: () => fetchOwnedPassportTokenIds(address!),
    enabled: isConnected && Boolean(address),
    staleTime: 60_000,
    refetchInterval: 120_000,
    refetchIntervalInBackground: false,
  });

  return data ?? [];
}
