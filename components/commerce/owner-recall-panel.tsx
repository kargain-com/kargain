"use client";

import { useCallback, useMemo, useState } from "react";
import { useChainId, useSwitchChain, useWriteContract } from "wagmi";

import {
  ReturnCooldownDisplay,
  useReturnRemainingSeconds,
} from "@/components/marketplace/return-cooldown-display";
import { Button } from "@/components/ui/button";
import { TX_SYNC_LAG_ADVISORY, useTxSync } from "@/hooks/use-tx-sync";
import { commerceModeAbi, commerceModeAddress } from "@/lib/commerce/mode";
import type { CommerceMode } from "@/lib/commerce/mode";
import { txErrorMessage } from "@/lib/marketplace/tx-error-message";
import { wagmiChainId } from "@/lib/web3/supported-chains";

type Props = {
  mode: CommerceMode;
  chainId: number;
  tokenId: string;
  /** `recallRequestTimestamp(tokenId)`; zero when no recall is pending. */
  recallRequestedAt: bigint;
  /** Recall only applies while an agent holds the live consignment. */
  hasAgent: boolean;
  onChanged?: () => void;
};

const MODE_COPY: Record<CommerceMode, string> = {
  fixedPrice:
    "Your KarPro can price and sell this vehicle without further approval. If they are unresponsive, request it back. After 7 days you may force the recall on-chain.",
  ascending:
    "A recall request does not stop bidding — if a qualifying bid lands first, the sale stands. After 7 days you may force the recall on-chain.",
};

/**
 * Owner recall on an agented consignment (`Recall.requestRecall` /
 * `forceRecall`). Replaces the escrow return-request flow.
 */
export function OwnerRecallPanel({
  mode,
  chainId,
  tokenId,
  recallRequestedAt,
  hasAgent,
  onChanged,
}: Props) {
  const wc = wagmiChainId(chainId);
  const walletChain = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync, isPending } = useWriteContract();
  const { runTx, phase, error, syncLagged } = useTxSync(chainId);
  const [txError, setTxError] = useState<string | null>(null);

  const market = commerceModeAddress(mode, chainId);
  const abi = commerceModeAbi(mode);
  const tid = useMemo(() => BigInt(tokenId), [tokenId]);
  const wrongChain = walletChain !== chainId;
  const busy = isPending || phase !== "idle";

  const remaining = useReturnRemainingSeconds(recallRequestedAt);
  const cooldownActive = recallRequestedAt > 0n && remaining > 0n;
  const cooldownElapsed = recallRequestedAt > 0n && remaining <= 0n;
  const noRequestYet = recallRequestedAt === 0n;

  const run = useCallback(
    async (functionName: "requestRecall" | "forceRecall") => {
      if (!market) return;
      setTxError(null);
      try {
        if (wrongChain) await switchChainAsync?.({ chainId: wc });
        const succeeded = await runTx(() =>
          writeContractAsync({
            address: market,
            abi,
            functionName,
            args: [tid],
          }),
        );
        if (succeeded) onChanged?.();
      } catch (err) {
        setTxError(txErrorMessage(err));
      }
    },
    [
      market,
      abi,
      wrongChain,
      switchChainAsync,
      wc,
      writeContractAsync,
      tid,
      onChanged,
      runTx,
    ],
  );

  if (!market || !hasAgent) return null;

  return (
    <div className="space-y-4 rounded-md border border-border-default bg-bg-surface p-4">
      <div>
        <p className="font-sans text-xs font-medium uppercase tracking-[0.12em] text-text-tertiary">
          Recall from agent
        </p>
        <p className="mt-2 text-sm text-text-secondary">{MODE_COPY[mode]}</p>
      </div>

      {noRequestYet && (
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          disabled={busy}
          onClick={() => void run("requestRecall")}
        >
          {busy ? "Confirming…" : "Request recall"}
        </Button>
      )}

      {(cooldownActive || cooldownElapsed) && (
        <>
          <ReturnCooldownDisplay returnRequestedAt={recallRequestedAt} />
          <div className="space-y-2">
            <Button
              type="button"
              variant="outline"
              className="w-full border-status-error text-status-error hover:bg-bg-surface"
              disabled={busy || cooldownActive}
              onClick={() => void run("forceRecall")}
            >
              {busy ? "Confirming…" : "Force recall"}
            </Button>
            {cooldownActive && (
              <p className="text-center text-xs text-text-secondary">
                Available after countdown ends
              </p>
            )}
          </div>
        </>
      )}

      {(txError ?? error) && (
        <p className="text-sm text-status-error" role="alert">
          {txError ?? error}
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
