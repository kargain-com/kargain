"use client";

import { type Address } from "viem";
import { mainnet } from "viem/chains";
import { useEnsAvatar, useEnsName } from "wagmi";

import { shortAddress } from "@/lib/web3/wallet-display";

export const ENS_CHAIN_ID = mainnet.id;

export function useEnsProfile(address: Address | undefined): {
  displayName: string;
  avatarUrl: string | null;
  isLoading: boolean;
} {
  const enabled = Boolean(address);

  const { data: ensName, isLoading: nameLoading } = useEnsName({
    address,
    chainId: ENS_CHAIN_ID,
    query: { enabled },
  });

  const { data: ensAvatar, isLoading: avatarLoading } = useEnsAvatar({
    name: ensName ?? undefined,
    chainId: ENS_CHAIN_ID,
    query: { enabled: enabled && Boolean(ensName) },
  });

  if (!address) {
    return { displayName: "", avatarUrl: null, isLoading: false };
  }

  return {
    displayName: ensName ?? shortAddress(address),
    avatarUrl: ensAvatar ?? null,
    isLoading: nameLoading || (Boolean(ensName) && avatarLoading),
  };
}
