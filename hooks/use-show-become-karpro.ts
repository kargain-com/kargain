"use client";

import { useActiveAccount, requireEvmSession } from "@/hooks/use-active-account";

import { useReadContract } from "wagmi";

import { KarProStakingAbi } from "@/lib/contracts/abis.generated";
import {
  resolveKarProTargetChainId,
  shouldShowBecomeKarPro,
} from "@/lib/kar-pro/kar-pro-target-chain";
import { karProStakingAddress } from "@/lib/web3/deployment-addresses";
import { wagmiChainId } from "@/lib/web3/supported-chains";

export function useShowBecomeKarPro(): boolean {
  const { account } = useActiveAccount();
  const evm = requireEvmSession(account);
  const address = evm.ok ? evm.address : undefined;
  const isConnected = evm.ok;
  const walletChainId = evm.ok ? evm.chainId : undefined;
  const chainId = resolveKarProTargetChainId(walletChainId);
  const staking = chainId != null ? karProStakingAddress(chainId) : undefined;
  const wc = chainId != null ? wagmiChainId(chainId) : undefined;

  const { data: isActiveVerifier } = useReadContract({
    address: staking,
    abi: KarProStakingAbi,
    functionName: "isActiveVerifier",
    args: address ? [address] : undefined,
    chainId: wc,
    query: {
      enabled: Boolean(isConnected && staking && address && chainId != null),
    },
  });

  // Non-commercial wallet → not active on target → still show CTA (/kar-pro prompts switch).
  const isActiveOnTarget = chainId != null && isActiveVerifier === true;

  return shouldShowBecomeKarPro({ isConnected, isActiveOnTarget });
}
