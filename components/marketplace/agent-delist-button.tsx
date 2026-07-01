"use client";

import { useCallback, useState } from "react";
import { waitForTransactionReceipt } from "wagmi/actions";
import {
  useAccount,
  useChainId,
  useConfig,
  useSwitchChain,
  useWriteContract,
} from "wagmi";

import { Button } from "@/components/ui/button";
import { MarketplaceEscrowAbi } from "@/lib/contracts/abis.generated";
import { txErrorMessage } from "@/lib/marketplace/tx-error-message";
import { marketplaceAddress } from "@/lib/web3/deployment-addresses";
import { wagmiChainId } from "@/lib/web3/supported-chains";

type Props = {
  chainId: number;
  tokenId: string;
  wallet: `0x${string}`;
  onSuccess: () => void;
};

export function AgentDelistButton({ chainId, tokenId, wallet, onSuccess }: Props) {
  const config = useConfig();
  const wc = wagmiChainId(chainId);
  const { address, isConnected } = useAccount();
  const walletChain = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync, isPending } = useWriteContract();

  const market = marketplaceAddress(chainId);
  const tid = BigInt(tokenId);
  const wrongChain = walletChain !== chainId;

  const [txError, setTxError] = useState<string | null>(null);

  const isAgentWallet =
    isConnected && address?.toLowerCase() === wallet.toLowerCase();

  const runAgentDelist = useCallback(async () => {
    if (!market || !isAgentWallet) return;
    if (wrongChain) await switchChainAsync?.({ chainId: wc });
    setTxError(null);
    try {
      const hash = await writeContractAsync({
        address: market,
        abi: MarketplaceEscrowAbi,
        functionName: "agentDelist",
        args: [tid],
      });
      await waitForTransactionReceipt(config, { hash });
      onSuccess();
    } catch (err) {
      setTxError(txErrorMessage(err));
    }
  }, [
    market,
    isAgentWallet,
    wrongChain,
    switchChainAsync,
    wc,
    writeContractAsync,
    tid,
    config,
    onSuccess,
  ]);

  return (
    <div className="mt-3 border-t border-border-default pt-3">
      {txError && (
        <p className="mb-2 text-sm text-status-error" role="alert">
          {txError}
        </p>
      )}
      {!isAgentWallet && (
        <p className="mb-2 text-xs text-text-secondary">
          Connect the agent wallet to return this vehicle to the owner.
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        className="w-full border-status-error text-status-error hover:bg-bg-surface"
        disabled={isPending || !isAgentWallet}
        onClick={() => void runAgentDelist()}
      >
        Return to owner
      </Button>
    </div>
  );
}
