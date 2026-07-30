"use client";

import { useAccount, useWriteContract } from "wagmi";

import { Button } from "@/components/ui/button";
import { TX_SYNC_LAG_ADVISORY, useTxSync } from "@/hooks/use-tx-sync";
import type { AuctionRow } from "@/lib/auction/map-ponder-auction";
import { addressesMatch, isZeroAddress } from "@/lib/commerce/consignment";
import { commerceModeAddress } from "@/lib/commerce/mode";
import { AscendingConsignmentAbi } from "@/lib/contracts/abis.generated";

type Props = {
  chainId: number;
  tokenId: string;
  auction: AuctionRow;
};

/**
 * Pre-bid exit — owner `ownerWithdraw` / agent `agentWithdraw`.
 * Visible only while the lot is still offered and unbid.
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

  const escrow = commerceModeAddress("ascending", chainId);

  const isSeller = addressesMatch(auction.seller, address);
  const isAgent =
    auction.agent != null &&
    !isZeroAddress(auction.agent) &&
    addressesMatch(auction.agent, address);

  if (!escrow || auction.startedAt !== 0n || (!isSeller && !isAgent)) {
    return null;
  }

  const runCancel = async () => {
    if (!escrow) return;
    await runTx(() =>
      writeContractAsync({
        address: escrow,
        abi: AscendingConsignmentAbi,
        functionName: isAgent ? "agentWithdraw" : "ownerWithdraw",
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
