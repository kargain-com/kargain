"use client";

import { useActiveAccount, requireEvmSession } from "@/hooks/use-active-account";

import { EvmSessionRefusal } from "@/components/shell/evm-session-refusal";
import { Button } from "@/components/ui/button";
import { TX_SYNC_LAG_ADVISORY, useTxSync } from "@/hooks/use-tx-sync";
import {
  ASCENDING_CANCEL_BEFORE_FIRST_BID,
  ASCENDING_NO_CANCEL_AFTER_BID,
} from "@/lib/auction/ascending-public-claims";
import type { AuctionRow } from "@/lib/auction/map-ponder-auction";
import { addressesMatch, isZeroAddress } from "@/lib/commerce/consignment";
import { commerceModeAddress } from "@/lib/commerce/mode";
import { AscendingConsignmentAbi } from "@/lib/contracts/abis.generated";
import { useEvmWriteContract } from "@/lib/web3/evm-write-adapter";

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
  const { account } = useActiveAccount();
  const evm = requireEvmSession(account);
  const address = evm.ok ? evm.address : undefined;
  const { writeContractAsync, isPending } = useEvmWriteContract();
  const { runTx, phase, error, syncLagged } = useTxSync(chainId);

  const busy = phase !== "idle";

  const mode = commerceModeAddress("ascending", chainId);

  if (!mode || auction.startedAt !== 0n) {
    return null;
  }

  if (!evm.ok) {
    return (
      <div className="space-y-3 rounded-md border border-border-default bg-bg-surface p-4">
        <EvmSessionRefusal
          cause={evm.cause}
          disconnectedTitle="Connect your wallet to cancel this auction."
        />
      </div>
    );
  }

  const isSeller = addressesMatch(auction.seller, address);
  const isAgent =
    auction.agent != null &&
    !isZeroAddress(auction.agent) &&
    addressesMatch(auction.agent, address);

  if (!isSeller && !isAgent) {
    return null;
  }

  const runCancel = async () => {
    if (!mode) return;
    await runTx(() =>
      writeContractAsync({
        address: mode,
        abi: AscendingConsignmentAbi,
        functionName: isAgent ? "agentWithdraw" : "ownerWithdraw",
        args: [BigInt(tokenId)],
      }),
    );
  };

  return (
    <div className="space-y-3 rounded-md border border-border-default bg-bg-surface p-4">
      <p className="font-sans text-sm text-text-secondary">
        {ASCENDING_CANCEL_BEFORE_FIRST_BID}
      </p>
      <p className="font-sans text-xs text-text-tertiary">
        {ASCENDING_NO_CANCEL_AFTER_BID}
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
