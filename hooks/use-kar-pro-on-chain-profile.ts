"use client";

import { useQuery } from "@tanstack/react-query";

import type { KarProVerifierProfile } from "@/lib/verifier/verifier-profile-types";
import {
  buildKarProProfileFromChain,
  resolveKarProJoinedAt,
  resolveKarProSlugFromMetadataUri,
} from "@/lib/kar-pro/kar-pro-verifier-profile";
import { proPassTokenIdFromAddress } from "@/lib/kar-pro/pro-pass-token-id";
import { KarProPassAbi, KarProStakingAbi } from "@/lib/contracts/abis.generated";
import {
  karProPassAddress,
  karProStakingAddress,
} from "@/lib/web3/deployment-addresses";
import { useKeyedReadContracts } from "@/lib/web3/keyed-multicall";
import { wagmiChainId } from "@/lib/web3/supported-chains";

export function useKarProOnChainProfile(
  address: `0x${string}` | undefined,
  enabled: boolean,
  chainId: number | undefined,
): { profile: KarProVerifierProfile | null; isLoading: boolean } {
  const wc = chainId != null ? wagmiChainId(chainId) : undefined;
  const proPass = chainId != null ? karProPassAddress(chainId) : undefined;
  const staking = chainId != null ? karProStakingAddress(chainId) : undefined;
  const readsEnabled = Boolean(
    enabled && address && chainId != null && proPass && staking && wc != null,
  );

  const passTokenId = address ? proPassTokenIdFromAddress(address) : 0n;

  const reads = useKeyedReadContracts({
    contracts: readsEnabled
      ? [
          {
            key: "passData" as const,
            address: proPass!,
            abi: KarProPassAbi,
            functionName: "getProPassData" as const,
            args: [passTokenId] as const,
            chainId: wc!,
          },
          {
            key: "stake" as const,
            address: staking!,
            abi: KarProStakingAbi,
            functionName: "stakes" as const,
            args: [address!] as const,
            chainId: wc!,
          },
        ]
      : [],
    query: { enabled: readsEnabled },
  });

  const passEntry = reads.entry("passData");
  const stakeEntry = reads.entry("stake");
  const passData =
    passEntry?.status === "success"
      ? (passEntry.result as readonly [string, number, string, string, bigint])
      : undefined;
  const stakeData =
    stakeEntry?.status === "success"
      ? (stakeEntry.result as readonly [
          `0x${string}`,
          bigint,
          bigint,
          boolean,
          bigint,
        ])
      : undefined;

  const passHolder = passData?.[0];
  const category = passData?.[1];
  const name = passData?.[2];
  const metadataURI = passData?.[3];
  const issuedAtTimestamp = passData?.[4];
  const stakeActive = stakeData?.[3] === true;
  const hasPass =
    Boolean(
      passHolder &&
        passHolder !== "0x0000000000000000000000000000000000000000",
    ) &&
    typeof category === "number" &&
    typeof name === "string" &&
    typeof metadataURI === "string";

  const chainFieldsReady =
    readsEnabled && !reads.isPending && hasPass && stakeActive;

  const { data: slug, isPending: slugPending } = useQuery({
    queryKey: ["kar-pro-slug", chainId ?? 0, metadataURI],
    queryFn: () => resolveKarProSlugFromMetadataUri(metadataURI!),
    enabled: chainFieldsReady && Boolean(metadataURI?.trim()),
    staleTime: 60_000,
  });

  if (!readsEnabled) {
    return { profile: null, isLoading: false };
  }

  if (reads.isPending) {
    return { profile: null, isLoading: true };
  }

  if (!hasPass || !stakeActive || !address) {
    return { profile: null, isLoading: false };
  }

  const slugLoading = Boolean(metadataURI?.trim()) && slugPending;

  if (slugLoading) {
    return { profile: null, isLoading: true };
  }

  const joinedAt = resolveKarProJoinedAt(stakeData?.[2], issuedAtTimestamp);

  return {
    profile: buildKarProProfileFromChain({
      address,
      category,
      name,
      metadataURI,
      joinedAt,
      slug: slug ?? "",
    }),
    isLoading: false,
  };
}
