"use client";

import { useState } from "react";
import {
  useAccount,
  useChainId,
  useConfig,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";

import { Button } from "@/components/ui/button";
import { hasAuctionAgent } from "@/lib/auction/auction-agent";
import type { AuctionRow } from "@/lib/auction/map-ponder-auction";
import { AuctionEscrowAbi } from "@/lib/contracts/abis.generated";
import { txErrorMessage } from "@/lib/marketplace/tx-error-message";
import { auctionEscrowAddress } from "@/lib/web3/deployment-addresses";
import { wagmiChainId } from "@/lib/web3/supported-chains";

type Props = {
  chainId: number;
  tokenId: string;
  auction: AuctionRow;
  onSuccess?: () => void;
};

/**
 * S1 cancel — seller `cancelAuction` / agent `agentCancelAuction`.
 * Visible only while `startedAt == 0`.
 */
export function AuctionCancelPanel({
  chainId,
  tokenId,
  auction,
  onSuccess,
}: Props) {
  const config = useConfig();
  const { address } = useAccount();
  const walletChainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync, isPending } = useWriteContract();

  const [txError, setTxError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const escrow = auctionEscrowAddress(chainId);
  const wrongChain = walletChainId !== wagmiChainId(chainId);

  const isSeller =
    Boolean(address) &&
    address!.toLowerCase() === auction.seller.toLowerCase();
  const isAgent =
    Boolean(address && hasAuctionAgent(auction.agent)) &&
    address!.toLowerCase() === auction.agent!.toLowerCase();

  if (!escrow || auction.startedAt !== 0n || (!isSeller && !isAgent)) {
    return null;
  }

  const runCancel = async () => {
    if (!escrow) return;
    setTxError(null);
    setBusy(true);
    try {
      if (wrongChain) {
        await switchChainAsync?.({ chainId: wagmiChainId(chainId) });
      }
      const hash = await writeContractAsync({
        address: escrow,
        abi: AuctionEscrowAbi,
        functionName: isAgent ? "agentCancelAuction" : "cancelAuction",
        args: [BigInt(tokenId)],
      });
      await waitForTransactionReceipt(config, { hash });
      onSuccess?.();
    } catch (err) {
      setTxError(txErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-border-default bg-bg-surface p-4">
      <p className="font-sans text-sm text-text-secondary">
        You can cancel only before the first qualifying bid.
      </p>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={busy || isPending}
        onClick={() => void runCancel()}
      >
        {busy || isPending ? "Cancelling…" : "Cancel auction"}
      </Button>
      {txError && (
        <p className="text-sm text-status-error" role="alert">
          {txError}
        </p>
      )}
    </div>
  );
}
