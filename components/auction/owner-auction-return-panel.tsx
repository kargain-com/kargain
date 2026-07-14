"use client";

import { useCallback, useMemo, useState } from "react";
import { waitForTransactionReceipt } from "wagmi/actions";
import {
  useChainId,
  useConfig,
  useSwitchChain,
  useWriteContract,
} from "wagmi";

import {
  ReturnCooldownDisplay,
  useReturnRemainingSeconds,
} from "@/components/marketplace/return-cooldown-display";
import { Button } from "@/components/ui/button";
import { AuctionEscrowAbi } from "@/lib/contracts/abis.generated";
import { txErrorMessage } from "@/lib/marketplace/tx-error-message";
import { auctionEscrowAddress } from "@/lib/web3/deployment-addresses";
import { wagmiChainId } from "@/lib/web3/supported-chains";

type Props = {
  chainId: number;
  tokenId: string;
  returnRequestedAt: bigint;
  /** Auction still pre-start (`startedAt == 0`). */
  preStart: boolean;
  onChanged: () => void;
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
  onChanged,
}: Props) {
  const config = useConfig();
  const wc = wagmiChainId(chainId);
  const walletChain = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync, isPending } = useWriteContract();

  const escrow = auctionEscrowAddress(chainId);
  const tid = useMemo(() => BigInt(tokenId), [tokenId]);
  const wrongChain = walletChain !== wc;

  const [txError, setTxError] = useState<string | null>(null);

  const returnAt = returnRequestedAt > 0n ? returnRequestedAt : 0n;
  const remaining = useReturnRemainingSeconds(returnAt);
  const cooldownActive = returnAt > 0n && remaining > 0n;
  const cooldownElapsed = returnAt > 0n && remaining <= 0n;
  const noRequestYet = returnAt === 0n;

  const runRequestReturn = useCallback(async () => {
    if (!escrow || !noRequestYet || !preStart) return;
    if (wrongChain) await switchChainAsync?.({ chainId: wc });
    setTxError(null);
    try {
      const hash = await writeContractAsync({
        address: escrow,
        abi: AuctionEscrowAbi,
        functionName: "requestReturn",
        args: [tid],
      });
      await waitForTransactionReceipt(config, { hash });
      onChanged();
    } catch (err) {
      setTxError(txErrorMessage(err));
    }
  }, [
    escrow,
    noRequestYet,
    preStart,
    wrongChain,
    switchChainAsync,
    wc,
    writeContractAsync,
    tid,
    config,
    onChanged,
  ]);

  const runForceReturn = useCallback(async () => {
    if (!escrow || !cooldownElapsed || !preStart) return;
    if (wrongChain) await switchChainAsync?.({ chainId: wc });
    setTxError(null);
    try {
      const hash = await writeContractAsync({
        address: escrow,
        abi: AuctionEscrowAbi,
        functionName: "forceReturn",
        args: [tid],
      });
      await waitForTransactionReceipt(config, { hash });
      onChanged();
    } catch (err) {
      setTxError(txErrorMessage(err));
    }
  }, [
    escrow,
    cooldownElapsed,
    preStart,
    wrongChain,
    switchChainAsync,
    wc,
    writeContractAsync,
    tid,
    config,
    onChanged,
  ]);

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
          disabled={isPending}
          onClick={() => void runRequestReturn()}
        >
          Request return
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
            disabled={isPending || cooldownActive}
            onClick={() => void runForceReturn()}
          >
            Force return
          </Button>
          {cooldownActive && (
            <p className="text-center text-xs text-text-secondary">
              Available after countdown ends
            </p>
          )}
        </div>
      )}

      {txError && (
        <p className="text-sm text-status-error" role="alert">
          {txError}
        </p>
      )}
    </div>
  );
}
