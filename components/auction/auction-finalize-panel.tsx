"use client";

import { useActiveAccount, requireEvmSession } from "@/hooks/use-active-account";

import { EvmSessionRefusal } from "@/components/shell/evm-session-refusal";
import { Button } from "@/components/ui/button";
import { TX_SYNC_LAG_ADVISORY, useTxSync } from "@/hooks/use-tx-sync";
import { formatAuctionAmount } from "@/lib/auction/format-auction";
import type { AuctionRow } from "@/lib/auction/map-ponder-auction";
import { formatWindowDurationLabel } from "@/lib/commerce/format-window-duration";
import { commerceModeAddress } from "@/lib/commerce/mode";
import { AscendingConsignmentAbi } from "@/lib/contracts/abis.generated";
import {
  commercialActive,
  nativeUnitOf,
} from "@/lib/web3/commercial-active";
import { wagmiChainId } from "@/lib/web3/supported-chains";
import { useEvmWriteContract } from "@/lib/web3/evm-write-adapter";

type Props = {
  chainId: number;
  tokenId: string;
  auction: AuctionRow;
  /** Lot snapshotted protection length (seconds). Omit numeric claim while unread. */
  protectionWindowSec?: number | null;
};

function finalizeProtectionCopy(protectionWindowSec: number | null | undefined): string {
  const label = formatWindowDurationLabel(protectionWindowSec ?? undefined);
  if (label) {
    return `Auction ended. Anyone can finalize: the vehicle transfers to the winner and payment enters a ${label} protection hold.`;
  }
  return "Auction ended. Anyone can finalize: the vehicle transfers to the winner and payment enters a protection hold.";
}

export function AuctionFinalizePanel({
  chainId,
  tokenId,
  auction,
  protectionWindowSec,
}: Props) {
  const { account } = useActiveAccount();
  const evm = requireEvmSession(account);
  const { writeContractAsync, isPending } = useEvmWriteContract();
  const { runTx, phase, error, syncLagged } = useTxSync(chainId);
  const busy = phase !== "idle";

  const mode = commerceModeAddress("ascending", chainId);
  const nativeUnit = nativeUnitOf(commercialActive(chainId)!);
  const finalBid =
    auction.highestBid > 0n
      ? formatAuctionAmount(auction.highestBid, auction.assetLabel, nativeUnit)
      : null;
  const lead = finalizeProtectionCopy(protectionWindowSec);

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

  if (!evm.ok) {
    return (
      <div className="space-y-3 rounded-md border border-border-default bg-bg-surface p-4">
        <p className="font-sans text-sm text-text-secondary">{lead}</p>
        <EvmSessionRefusal
          cause={evm.cause}
          disconnectedTitle="Connect a wallet to finalize this auction."
        />
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
        disabled={busy || isPending}
        onClick={() => void onFinalize()}
      >
        {busy || isPending ? "Finalizing…" : "Finalize auction"}
      </Button>
    </div>
  );
}
