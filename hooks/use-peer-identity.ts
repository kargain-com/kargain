"use client";

import { useAccount, useEnsName, useReadContract } from "wagmi";

import { useKarProVerifierProfile } from "@/hooks/use-kar-pro-verifier-profile";
import { ENS_CHAIN_ID } from "@/hooks/use-ens-profile";
import { resolveKarProTargetChainId } from "@/lib/kar-pro/kar-pro-target-chain";
import { KarProStakingAbi } from "@/lib/contracts/abis.generated";
import { karProStakingAddress } from "@/lib/web3/deployment-addresses";
import { wagmiChainId } from "@/lib/web3/supported-chains";
import { navShortAddress } from "@/lib/web3/wallet-display";

export type PeerIdentity = {
  displayName: string;
  isKarPro: boolean;
  profileHref: string;
  isLoading: boolean;
};

const EMPTY_PEER_IDENTITY: PeerIdentity = {
  displayName: "",
  isKarPro: false,
  profileHref: "/messages",
  isLoading: false,
};

export function usePeerIdentity(
  peerAddress: `0x${string}` | undefined,
  options?: { chainId?: number | null },
): PeerIdentity {
  const { chainId: walletChainId } = useAccount();
  const chainId =
    options?.chainId !== undefined
      ? options.chainId
      : resolveKarProTargetChainId(walletChainId);

  const { data: ensName, isLoading: ensNameLoading } = useEnsName({
    address: peerAddress,
    chainId: ENS_CHAIN_ID,
    query: { enabled: Boolean(peerAddress) },
  });

  const staking = chainId != null ? karProStakingAddress(chainId) : undefined;
  const wc = chainId != null ? wagmiChainId(chainId) : undefined;

  const { data: isActiveVerifier } = useReadContract({
    address: staking,
    abi: KarProStakingAbi,
    functionName: "isActiveVerifier",
    args: peerAddress ? [peerAddress] : undefined,
    chainId: wc,
    query: { enabled: Boolean(staking && peerAddress && chainId != null) },
  });

  const { profile: verifierProfile } = useKarProVerifierProfile(peerAddress, {
    isActiveVerifier: isActiveVerifier === true,
    chainId,
    syncWhileMissing: false,
  });

  if (!peerAddress) {
    return EMPTY_PEER_IDENTITY;
  }

  const trimmedKarProName = verifierProfile?.name?.trim() ?? "";

  return {
    displayName: trimmedKarProName || ensName?.trim() || navShortAddress(peerAddress),
    isKarPro: isActiveVerifier === true,
    profileHref: `/profile/${peerAddress}`,
    isLoading: trimmedKarProName.length === 0 && ensNameLoading,
  };
}
