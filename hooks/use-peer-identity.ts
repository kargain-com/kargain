"use client";

import { useEnsName, useReadContract } from "wagmi";

import { useKarProMembershipRoster } from "@/hooks/use-kar-pro-membership-roster";
import { useKarProVerifierProfile } from "@/hooks/use-kar-pro-verifier-profile";
import { ENS_CHAIN_ID } from "@/hooks/use-ens-profile";
import {
  karProAnyActive,
  preferActiveMembershipChainId,
} from "@/lib/kar-pro/membership-roster";
import { isCommercialChainId } from "@/lib/web3/commercial-active";
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

/**
 * Peer KarPro badge + display name.
 * - Positive commercial `options.chainId` → membership on that chain only.
 * - Omitted / null chain → anyActive from membership roster (not wallet target).
 */
export function usePeerIdentity(
  peerAddress: `0x${string}` | undefined,
  options?: { chainId?: number | null },
): PeerIdentity {
  const membershipChainId =
    options?.chainId != null &&
    Number.isFinite(options.chainId) &&
    isCommercialChainId(options.chainId)
      ? options.chainId
      : null;

  const useAnyActive = membershipChainId == null && Boolean(peerAddress);

  const { data: ensName, isLoading: ensNameLoading } = useEnsName({
    address: peerAddress,
    chainId: ENS_CHAIN_ID,
    query: { enabled: Boolean(peerAddress) },
  });

  const staking =
    membershipChainId != null
      ? karProStakingAddress(membershipChainId)
      : undefined;
  const wc =
    membershipChainId != null ? wagmiChainId(membershipChainId) : undefined;

  const { data: chainActive, isPending: chainActivePending } = useReadContract({
    address: staking,
    abi: KarProStakingAbi,
    functionName: "isActiveVerifier",
    args: peerAddress ? [peerAddress] : undefined,
    chainId: wc,
    query: {
      enabled: Boolean(
        membershipChainId != null && staking && peerAddress && wc != null,
      ),
    },
  });

  const { rows: rosterRows, isPending: rosterPending } = useKarProMembershipRoster(
    useAnyActive ? peerAddress : undefined,
    null,
  );

  const isKarPro =
    membershipChainId != null
      ? chainActive === true
      : karProAnyActive(rosterRows);

  const detailChainId =
    membershipChainId ??
    (isKarPro ? preferActiveMembershipChainId(rosterRows, null) : null);

  const { profile: verifierProfile } = useKarProVerifierProfile(peerAddress, {
    isActiveVerifier: isKarPro,
    chainId: detailChainId,
    syncWhileMissing: false,
  });

  if (!peerAddress) {
    return EMPTY_PEER_IDENTITY;
  }

  const trimmedKarProName = verifierProfile?.name?.trim() ?? "";
  const statusPending =
    membershipChainId != null ? chainActivePending : rosterPending;

  return {
    displayName:
      trimmedKarProName || ensName?.trim() || navShortAddress(peerAddress),
    isKarPro,
    profileHref: `/profile/${peerAddress}`,
    isLoading:
      statusPending || (trimmedKarProName.length === 0 && ensNameLoading),
  };
}
