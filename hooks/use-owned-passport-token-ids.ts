"use client";

import { useActiveAccount, requireEvmSession } from "@/hooks/use-active-account";

import { useQuery } from "@tanstack/react-query";

import { fetchOwnedPassportTokenIds } from "@/app/actions/notifications";

export function useOwnedPassportTokenIds(): string[] {
  const { account } = useActiveAccount();
  const evm = requireEvmSession(account);
  const address = evm.ok ? evm.address : undefined;
  const isConnected = evm.ok;

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
