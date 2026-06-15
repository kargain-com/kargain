"use client";

import { getAddress, type Address } from "viem";
import { mainnet } from "viem/chains";
import { useEnsAvatar, useEnsName } from "wagmi";

export const ENS_CHAIN_ID = mainnet.id;

function shortAddress(address: Address): string {
  try {
    const normalized = getAddress(address);
    return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`;
  } catch {
    return address.length > 10 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address;
  }
}

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
