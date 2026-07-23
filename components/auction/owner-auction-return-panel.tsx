"use client";

import { useCallback, useMemo } from "react";
import { useWriteContract } from "wagmi";

import {
  ReturnCooldownDisplay,
  useReturnRemainingSeconds,
} from "@/components/marketplace/return-cooldown-display";
import { Button } from "@/components/ui/button";
import { TX_SYNC_LAG_ADVISORY, useTxSync } from "@/hooks/use-tx-sync";
import { AuctionEscrowAbi } from "@/lib/contracts/abis.generated";
import { auctionEscrowAddress } from "@/lib/web3/deployment-addresses";

type Props = {
  chainId: number;
  tokenId: string;
  returnRequestedAt: bigint;
  /** Auction still pre-start (`startedAt == 0`). */
  preStart: boolean;
};

/**
 * Owner return on agent auction (pre-start only). Bidding stays open after
 * request — mirror of marketplace return panel layout.
 */
export function OwnerAuctionReturnPanel({
  chainId,
  tokenId,
  returnRequestedAt,
  preStart,
}: Props) {
  const { writeContractAsync, isPending } = useWriteContract();
  const { runTx, phase, error, syncLagged } = useTxSync(chainId);

  const escrow = auctionEscrowAddress(chainId);
  const tid = useMemo(() => BigInt(tokenId), [tokenId]);
  const busy = phase !== "idle";

  const returnAt = returnRequestedAt > 0n ? returnRequestedAt : 0n;
  const remaining = useReturnRemainingSeconds(returnAt);
  const cooldownActive = returnAt > 0n && remaining > 0n;
  const cooldownElapsed = returnAt > 0n && remaining <= 0n;
  const noRequestYet = returnAt === 0n;

  const runRequestReturn = useCallback(async () => {
    if (!escrow || !noRequestYet || !preStart) return;
    await runTx(() =>
      writeContractAsync({
        address: escrow,
        abi: AuctionEscrowAbi,
        functionName: "requestReturn",
        args: [tid],
      }),
    );
  }, [escrow, noRequestYet, preStart, writeContractAsync, tid, runTx]);

  const runForceReturn = useCallback(async () => {
    if (!escrow || !cooldownElapsed || !preStart) return;
    await runTx(() =>
      writeContractAsync({
        address: escrow,
        abi: AuctionEscrowAbi,
        functionName: "forceReturn",
        args: [tid],
      }),
    );
  }, [escrow, cooldownElapsed, preStart, writeContractAsync, tid, runTx]);

  if (!escrow || !preStart) return null;

  return (
    <div className="space-y-4 rounded-md border border-border-default bg-bg-surface p-4">
      <div>
        <p className="font-sans text-xs font-medium uppercase tracking-[0.12em] text-text-tertiary">
          Return from agent
        </p>
        <p className="mt-2 text-sm text-text-secondary">
          Return request does not stop bidding — if a bid lands first, the sale
          stands. After 7 days with no qualifying bid you may force the return
          on-chain.
        </p>
      </div>

      {noRequestYet && (
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          disabled={busy || isPending}
          onClick={() => void runRequestReturn()}
        >
          {phase === "indexing" || busy ? "Confirming…" : "Request return"}
        </Button>
      )}

      {(cooldownActive || cooldownElapsed) && (
        <ReturnCooldownDisplay returnRequestedAt={returnAt} />
      )}

      {(cooldownActive || cooldownElapsed) && (
        <div className="space-y-2">
          <Button
            type="button"
            variant="outline"
            className="w-full border-status-error text-status-error hover:bg-bg-surface"
            disabled={busy || isPending || cooldownActive}
            onClick={() => void runForceReturn()}
          >
            {phase === "indexing" || busy ? "Confirming…" : "Force return"}
          </Button>
          {cooldownActive && (
            <p className="text-center text-xs text-text-secondary">
              Available after countdown ends
            </p>
          )}
        </div>
      )}

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
