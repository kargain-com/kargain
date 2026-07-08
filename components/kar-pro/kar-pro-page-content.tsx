"use client";

import { useState } from "react";
import { useAccount, useReadContract } from "wagmi";

import { KarProClient } from "@/components/kar-pro/kar-pro-client";
import { formatStakeEth } from "@/lib/kar-pro/stake-format";
import { KarProStakingAbi } from "@/lib/contracts/abis.generated";
import { karProStakingAddress } from "@/lib/web3/deployment-addresses";
import { DEFAULT_CHAIN_ID } from "@/lib/web3/supported-chains";

const VALUE_PROPS = [
  { label: "Fully refundable stake", stakeStat: true as const },
  { value: "No lock", label: "Leave anytime" },
  { value: "On-chain", label: "Permanent reputation" },
] as const;

export function KarProPageContent() {
  const chainId = DEFAULT_CHAIN_ID;
  const { address, isConnected } = useAccount();
  const staking = karProStakingAddress(chainId);
  const [postTxActive, setPostTxActive] = useState<boolean | null>(null);

  const { data: onChainActive } = useReadContract({
    address: staking,
    abi: KarProStakingAbi,
    functionName: "isActiveVerifier",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(staking && address && isConnected) },
  });

  const { data: minStake, isPending: minStakePending } = useReadContract({
    address: staking,
    abi: KarProStakingAbi,
    functionName: "minStakeNative",
    query: { enabled: Boolean(staking) },
  });

  const stakeLabel = formatStakeEth(minStake);

  const [prevIdentity, setPrevIdentity] = useState(`${address}:${isConnected}`);
  const identity = `${address}:${isConnected}`;
  if (identity !== prevIdentity) {
    setPrevIdentity(identity);
    if (postTxActive !== null) setPostTxActive(null);
  }

  const isActiveVerifier = !isConnected ? false : (postTxActive ?? onChainActive === true);
  const showValueProps = !isActiveVerifier;

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-16 md:px-8 xl:max-w-[80rem]">
      <KarProClient onVerifierStatusChange={setPostTxActive} />
      {showValueProps && (
        <div className="mx-auto mt-16 max-w-3xl grid grid-cols-1 sm:grid-cols-3 gap-px bg-border-default">
          {VALUE_PROPS.map((prop) => (
            <div
              key={prop.label}
              className="flex flex-col gap-2 py-6 md:py-10 px-6 bg-bg-surface text-center sm:text-left"
            >
              <p className="font-mono text-2xl md:text-4xl font-normal tabular-nums tracking-tight text-text-primary">
                {"stakeStat" in prop ? (
                  minStakePending ? (
                    <span
                      className="inline-block h-4 w-16 animate-pulse rounded-sm bg-bg-surface align-baseline"
                      aria-hidden
                    />
                  ) : (
                    `${stakeLabel} ETH`
                  )
                ) : (
                  prop.value
                )}
              </p>
              <p className="font-sans text-sm font-normal text-text-secondary">{prop.label}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
