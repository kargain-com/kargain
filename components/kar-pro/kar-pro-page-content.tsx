"use client";

import { useActiveAccount, requireEvmSession } from "@/hooks/use-active-account";

import { useState } from "react";
import { useReadContract } from "wagmi";

import { KarProClient } from "@/components/kar-pro/kar-pro-client";
import { formatStakeNative } from "@/lib/kar-pro/stake-format";
import { resolveKarProTargetChainId } from "@/lib/kar-pro/kar-pro-target-chain";
import { KarProStakingAbi } from "@/lib/contracts/abis.generated";
import {
  COMMERCIAL_ACTIVE,
  commercialActive,
  nativeUnitOf,
} from "@/lib/web3/commercial-active";
import { karProStakingAddress } from "@/lib/web3/deployment-addresses";
import { wagmiChainId } from "@/lib/web3/supported-chains";

const VALUE_PROPS = [
  { label: "Refundable stake", stakeStat: true as const },
  { value: "No lock", label: "Leave anytime" },
  { value: "On-chain", label: "Permanent reputation" },
] as const;

export function KarProPageContent() {
  const { account } = useActiveAccount();
  const evm = requireEvmSession(account);
  const address = evm.ok ? evm.address : undefined;
  const isConnected = evm.ok;
  const walletChainId = evm.ok ? evm.chainId : undefined;
  const chainId = resolveKarProTargetChainId(walletChainId);
  const staking = chainId != null ? karProStakingAddress(chainId) : undefined;
  const wc = chainId != null ? wagmiChainId(chainId) : undefined;
  const [postTxActive, setPostTxActive] = useState<boolean | null>(null);

  const { data: onChainActive } = useReadContract({
    address: staking,
    abi: KarProStakingAbi,
    functionName: "isActiveVerifier",
    args: address ? [address] : undefined,
    chainId: wc,
    query: { enabled: Boolean(staking && address && isConnected && chainId != null) },
  });

  const { data: minStake, isPending: minStakePending } = useReadContract({
    address: staking,
    abi: KarProStakingAbi,
    functionName: "minStakeNative",
    chainId: wc,
    query: { enabled: Boolean(staking && chainId != null) },
  });

  const stack = chainId != null ? commercialActive(chainId) : undefined;
  const unit = stack
    ? nativeUnitOf(stack)
    : nativeUnitOf(COMMERCIAL_ACTIVE[84532]!);
  const stakeLabel = formatStakeNative(minStake, unit);

  const [prevIdentity, setPrevIdentity] = useState(`${address}:${isConnected}:${chainId}`);
  const identity = `${address}:${isConnected}:${chainId}`;
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
                  chainId == null || minStakePending ? (
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
