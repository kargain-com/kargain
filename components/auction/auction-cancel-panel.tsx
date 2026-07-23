"use client";

import { useAccount, useWriteContract } from "wagmi";

import { Button } from "@/components/ui/button";
import { TX_SYNC_LAG_ADVISORY, useTxSync } from "@/hooks/use-tx-sync";
import { hasAuctionAgent } from "@/lib/auction/auction-agent";
import type { AuctionRow } from "@/lib/auction/map-ponder-auction";
import { AuctionEscrowAbi } from "@/lib/contracts/abis.generated";
import { auctionEscrowAddress } from "@/lib/web3/deployment-addresses";

type Props = {
  chainId: number;
  tokenId: string;
  auction: AuctionRow;
};

/**
 * S1 cancel — seller `cancelAuction` / agent `agentCancelAuction`.
 * Visible only while `startedAt == 0`.
 */
export function AuctionCancelPanel({
  chainId,
  tokenId,
  auction,
}: Props) {
  const { address } = useAccount();
  const { writeContractAsync, isPending } = useWriteContract();
  const { runTx, phase, error, syncLagged } = useTxSync(chainId);

  const busy = phase !== "idle";

  const escrow = auctionEscrowAddress(chainId);

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
    await runTx(() =>
      writeContractAsync({
        address: escrow,
        abi: AuctionEscrowAbi,
        functionName: isAgent ? "agentCancelAuction" : "cancelAuction",
        args: [BigInt(tokenId)],
      }),
    );
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
        {phase === "indexing" || busy || isPending
          ? "Confirming…"
          : "Cancel auction"}
      </Button>
      {error && (
        <p className="text-sm text-status-error" role="alert">
          {error}
        </p>
      )}
      {syncLagged && (
        <p role="status" className="font-sans text-xs text-text-tertiary">
          {TX_SYNC_LAG_ADVISORY}
        </p>
      )}
    </div>
  );
}
