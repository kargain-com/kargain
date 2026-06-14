"use client";

import { useState } from "react";
import { parseEther } from "viem";
import {
  useAccount,
  useChainId,
  useReadContracts,
  useSwitchChain,
  useWriteContract,
} from "wagmi";

import { ChainSelector } from "@/components/shell/chain-selector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WalletLoginButton } from "@/components/wallet-login-button";
import { KarProStakingAbi } from "@/lib/contracts/abis.generated";
import {
  karProStakingAddress,
} from "@/lib/web3/deployment-addresses";
import { DEFAULT_CHAIN_ID, wagmiChainId } from "@/lib/web3/supported-chains";

export function KarProClient({ embedded = false }: { embedded?: boolean }) {
  const chainId = DEFAULT_CHAIN_ID;
  const { address, isConnected } = useAccount();
  const walletChain = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync, isPending } = useWriteContract();
  const [name, setName] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const staking = karProStakingAddress(chainId);
  const wc = wagmiChainId(chainId);
  const wrongChain = isConnected && walletChain !== chainId;

  const { data: reads } = useReadContracts({
    contracts: staking
      ? [
          { address: staking, abi: KarProStakingAbi, functionName: "minStakeNative" },
          ...(address
            ? [
                {
                  address: staking,
                  abi: KarProStakingAbi,
                  functionName: "isActiveVerifier",
                  args: [address],
                },
              ]
            : []),
        ]
      : [],
  });

  const minStake = reads?.[0]?.result as bigint | undefined;
  const isVerifier = (reads?.[1]?.result as boolean | undefined) === true;

  const join = async () => {
    if (!staking || !name.trim()) return;
    if (wrongChain) await switchChainAsync?.({ chainId: wc });
    await writeContractAsync({
      address: staking,
      abi: KarProStakingAbi,
      functionName: "becomeVerifierNative",
      args: [5, name.trim(), ""],
      value: minStake ?? parseEther("0.05"),
    });
    setMessage("Joined as verifier.");
  };

  const leave = async () => {
    if (!staking) return;
    if (wrongChain) await switchChainAsync?.({ chainId: wc });
    await writeContractAsync({
      address: staking,
      abi: KarProStakingAbi,
      functionName: "leave",
    });
    setMessage("Left verifier staking.");
  };

  return (
    <div className={embedded ? "space-y-5 text-text-primary" : "mx-auto max-w-lg space-y-8 px-4 py-12 text-text-primary"}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className={embedded ? "text-lg font-medium tracking-tight" : "text-2xl font-medium tracking-tight"}>
            Kar Pro
          </h1>
        </div>
        <ChainSelector />
      </div>

      {!isConnected ? (
        <WalletLoginButton />
      ) : !staking ? (
        <p className="text-sm text-text-secondary">Staking not configured for this chain.</p>
      ) : isVerifier ? (
        <div className="space-y-3 rounded-md border border-border-default bg-bg-surface p-4">
          <p className="text-sm text-text-secondary">You are an active verifier.</p>
          <Button type="button" variant="outline" disabled={isPending} onClick={() => void leave()}>
            Leave staking
          </Button>
        </div>
      ) : (
        <div className="space-y-3 rounded-md border border-border-default bg-bg-surface p-4">
          <Label htmlFor="verifier-name">Verifier display name</Label>
          <Input id="verifier-name" value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="button" disabled={isPending || !name.trim()} onClick={() => void join()}>
            Join as verifier
          </Button>
        </div>
      )}

      {message && <p className="text-sm text-text-secondary">{message}</p>}
    </div>
  );
}
