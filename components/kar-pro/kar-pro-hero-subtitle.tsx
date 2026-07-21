"use client";

import { useAccount, useReadContract } from "wagmi";

import { formatStakeEth } from "@/lib/kar-pro/stake-format";
import { resolveKarProTargetChainId } from "@/lib/kar-pro/kar-pro-target-chain";
import { KarProStakingAbi } from "@/lib/contracts/abis.generated";
import { karProStakingAddress } from "@/lib/web3/deployment-addresses";
import { wagmiChainId } from "@/lib/web3/supported-chains";

export function KarProHeroSubtitle() {
  const { chainId: walletChainId } = useAccount();
  const chainId = resolveKarProTargetChainId(walletChainId);
  const staking = chainId != null ? karProStakingAddress(chainId) : undefined;
  const wc = chainId != null ? wagmiChainId(chainId) : undefined;

  const { data: minStake, isPending: minStakePending } = useReadContract({
    address: staking,
    abi: KarProStakingAbi,
    functionName: "minStakeNative",
    chainId: wc,
    query: { enabled: Boolean(staking && chainId != null) },
  });

  const stakeLabel = formatStakeEth(minStake);
  const showPending = chainId == null || minStakePending;

  return (
    <p className="font-sans text-fluid-body-lg font-normal leading-[1.55] text-text-secondary mt-4">
      Become a trusted verifier. Stake{" "}
      {showPending ? (
        <span
          className="inline-block h-4 w-16 animate-pulse rounded-sm bg-bg-surface align-baseline"
          aria-hidden
        />
      ) : (
        `${stakeLabel} ETH`
      )}
      , build your reputation, help buyers trust sellers.
    </p>
  );
}
