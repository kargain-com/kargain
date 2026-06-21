"use client";

import { useQuery } from "@tanstack/react-query";
import { useEnsName, useReadContract } from "wagmi";

import { fetchKarProVerifierProfile } from "@/app/actions/kar-pro-verifier";
import { ENS_CHAIN_ID, useEnsProfile } from "@/hooks/use-ens-profile";
import { useNostrProfile } from "@/hooks/use-nostr-profile";
import { KarProStakingAbi } from "@/lib/contracts/abis.generated";
import { karProStakingAddress } from "@/lib/web3/deployment-addresses";
import { DEFAULT_CHAIN_ID } from "@/lib/web3/supported-chains";
import { navShortAddress } from "@/lib/web3/wallet-display";

export type PeerIdentity = {
  displayName: string;
  avatarUrl: string | null;
  isKarPro: boolean;
  profileHref: string;
  isLoading: boolean;
};

const EMPTY_PEER_IDENTITY: PeerIdentity = {
  displayName: "",
  avatarUrl: null,
  isKarPro: false,
  profileHref: "/messages",
  isLoading: false,
};

export function usePeerIdentity(peerAddress: `0x${string}` | undefined): PeerIdentity {
  const { profile: nostrProfile } = useNostrProfile(peerAddress);
  const { avatarUrl: ensAvatarUrl } = useEnsProfile(peerAddress);
  const { data: ensName, isLoading: ensNameLoading } = useEnsName({
    address: peerAddress,
    chainId: ENS_CHAIN_ID,
    query: { enabled: Boolean(peerAddress) },
  });

  const staking = karProStakingAddress(DEFAULT_CHAIN_ID);
  const { data: isActiveVerifier } = useReadContract({
    address: staking,
    abi: KarProStakingAbi,
    functionName: "isActiveVerifier",
    args: peerAddress ? [peerAddress] : undefined,
    query: { enabled: Boolean(staking && peerAddress) },
  });

  const { data: verifierProfile } = useQuery({
    queryKey: ["kar-pro-verifier", peerAddress],
    queryFn: () => fetchKarProVerifierProfile(peerAddress!),
    enabled: Boolean(peerAddress && isActiveVerifier === true),
  });

  if (!peerAddress) {
    return EMPTY_PEER_IDENTITY;
  }

  const trimmedKarProName = verifierProfile?.name?.trim() ?? "";
  const nostrPicture = nostrProfile?.picture?.trim();
  const avatarUrl = nostrPicture || ensAvatarUrl || null;

  return {
    displayName: trimmedKarProName || ensName?.trim() || navShortAddress(peerAddress),
    avatarUrl,
    isKarPro: isActiveVerifier === true,
    profileHref: `/profile/${peerAddress}`,
    isLoading: trimmedKarProName.length === 0 && ensNameLoading,
  };
}
