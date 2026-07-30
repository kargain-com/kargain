"use client";

import { useAccount, useWriteContract } from "wagmi";

import { Button } from "@/components/ui/button";
import { WalletLoginButton } from "@/components/wallet-login-button";
import { useAscendingAuctionRules } from "@/hooks/use-ascending-auction-rules";
import { TX_SYNC_LAG_ADVISORY, useTxSync } from "@/hooks/use-tx-sync";
import { formatAuctionAmount } from "@/lib/auction/format-auction";
import type { AuctionRow } from "@/lib/auction/map-ponder-auction";
import { formatWindowDurationLabel } from "@/lib/commerce/format-window-duration";
import { commerceModeAddress } from "@/lib/commerce/mode";
import { AscendingConsignmentAbi } from "@/lib/contracts/abis.generated";
import { wagmiChainId } from "@/lib/web3/supported-chains";

type Props = {
  chainId: number;
  tokenId: string;
  auction: AuctionRow;
};

function finalizeProtectionCopy(protectionWindowSec: number | null): string {
  const label = formatWindowDurationLabel(protectionWindowSec ?? undefined);
  if (label) {
    return `Auction ended. Anyone can finalize: the vehicle transfers to the winner and payment enters a ${label} protection hold.`;
  }
  return "Auction ended. Anyone can finalize: the vehicle transfers to the winner and payment enters a protection hold.";
}

export function AuctionFinalizePanel({ chainId, tokenId, auction }: Props) {
  const { isConnected } = useAccount();
  const { writeContractAsync, isPending } = useWriteContract();
  const { runTx, phase, error, syncLagged } = useTxSync(chainId);
  const busy = phase !== "idle";
  const { rules } = useAscendingAuctionRules({ chainId });

  const mode = commerceModeAddress("ascending", chainId);
  const finalBid =
    auction.highestBid > 0n
      ? formatAuctionAmount(auction.highestBid, auction.assetLabel)
      : null;
  const lead = finalizeProtectionCopy(rules?.protectionWindow ?? null);

  async function onFinalize() {
    if (!mode) return;
    await runTx(() =>
      writeContractAsync({
        address: mode,
        abi: AscendingConsignmentAbi,
        functionName: "settle",
        args: [BigInt(tokenId)],
        chainId: wagmiChainId(chainId),
      }),
    );
  }

  if (!isConnected) {
    return (
      <div className="space-y-3 rounded-md border border-border-default bg-bg-surface p-4">
        <p className="font-sans text-sm text-text-secondary">{lead}</p>
        <WalletLoginButton />
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-md border border-border-default bg-bg-surface p-4">
      <p className="font-sans text-sm text-text-primary">{lead}</p>
      {finalBid && (
        <p className="font-mono text-sm tabular-nums text-text-primary">
          Final bid {finalBid}
        </p>
      )}
      <p className="font-sans text-sm text-text-secondary">
        Anyone can finalize — this transfers the vehicle and starts the payout
        hold.
      </p>
      {error && (
        <p className="font-sans text-sm text-status-error" role="alert">
          {error}
        </p>
      )}
      {syncLagged && (
        <p role="status" className="font-sans text-xs text-text-tertiary">
          {TX_SYNC_LAG_ADVISORY}
        </p>
      )}
      <Button
        type="button"
        className="w-full"
        disabled={busy || isPending || !mode}
        onClick={() => void onFinalize()}
      >
        {phase === "indexing" || busy || isPending
          ? "Confirming…"
          : "Finalize auction"}
      </Button>
    </div>
  );
}
