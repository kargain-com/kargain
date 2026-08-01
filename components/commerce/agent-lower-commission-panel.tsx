"use client";

import { useCallback, useMemo, useState } from "react";
import { useChainId, useSwitchChain, useWriteContract } from "wagmi";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TX_SYNC_LAG_ADVISORY, useTxSync } from "@/hooks/use-tx-sync";
import { lowerCommissionConcessionEffect } from "@/lib/commerce/compensation-form";
import {
  deriveAgentLowerCommissionConcession,
  isConcessionAvailable,
} from "@/lib/commerce/concession-surface";
import type { CompensationForm } from "@/lib/commerce/denomination";
import {
  commerceModeAbi,
  commerceModeAddress,
  type CommerceMode,
} from "@/lib/commerce/mode";
import { txErrorMessage } from "@/lib/marketplace/tx-error-message";
import { wagmiChainId } from "@/lib/web3/supported-chains";

type Props = {
  mode: CommerceMode;
  chainId: number;
  tokenId: string;
  live: boolean | undefined;
  isConsignmentAgent: boolean | undefined;
  compensationForm: CompensationForm | undefined;
  snapshotCommissionBps: number | undefined;
  onChanged?: () => void;
  /** When true, omit the outer card chrome (embedded in another panel). */
  embedded?: boolean;
};

function parseCommissionBps(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const pct = Number(trimmed);
  if (!Number.isFinite(pct) || pct < 0) return null;
  return Math.round(pct * 100);
}

/**
 * Agent concession: `lowerCommission` on a live Commission-form consignment.
 * Availability from {@link deriveAgentLowerCommissionConcession} — mode-agnostic.
 */
export function AgentLowerCommissionPanel({
  mode,
  chainId,
  tokenId,
  live,
  isConsignmentAgent,
  compensationForm,
  snapshotCommissionBps,
  onChanged,
  embedded = false,
}: Props) {
  const wc = wagmiChainId(chainId);
  const walletChain = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync, isPending } = useWriteContract();
  const { runTx, phase, error, syncLagged } = useTxSync(chainId);
  const busy = isPending || phase !== "idle";

  const market = commerceModeAddress(mode, chainId);
  const abi = commerceModeAbi(mode);
  const tid = useMemo(() => BigInt(tokenId), [tokenId]);
  const wrongChain = walletChain !== chainId;

  const gate = deriveAgentLowerCommissionConcession({
    live,
    isConsignmentAgent,
    compensationForm,
    snapshotCommissionBps,
  });

  const [input, setInput] = useState("");
  const [txError, setTxError] = useState<string | null>(null);

  const nextBps = useMemo(() => parseCommissionBps(input), [input]);
  const currentBps = snapshotCommissionBps ?? 0;
  const canSubmit =
    nextBps != null && nextBps < currentBps && nextBps >= 0;
  const invalid = input.trim().length > 0 && !canSubmit;

  const runLower = useCallback(async () => {
    if (!market || !canSubmit || nextBps == null) return;
    if (wrongChain) await switchChainAsync?.({ chainId: wc });
    setTxError(null);
    try {
      const succeeded = await runTx(() =>
        writeContractAsync({
          address: market,
          abi,
          functionName: "lowerCommission",
          args: [tid, nextBps],
        }),
      );
      if (!succeeded) return;
      setInput("");
      onChanged?.();
    } catch (err) {
      setTxError(txErrorMessage(err));
    }
  }, [
    market,
    canSubmit,
    nextBps,
    wrongChain,
    switchChainAsync,
    wc,
    writeContractAsync,
    abi,
    tid,
    onChanged,
    runTx,
  ]);

  if (!isConcessionAvailable(gate) || !market) return null;

  const effect = lowerCommissionConcessionEffect();
  const currentPct = (currentBps / 100).toFixed(2);

  const body = (
    <>
      <div className="space-y-1">
        {!embedded && (
          <p className="font-sans text-xs font-medium uppercase tracking-[0.12em] text-text-tertiary">
            Commission
          </p>
        )}
        <p className="font-mono text-sm tabular-nums text-text-primary">
          {currentPct}%
        </p>
        <p className="font-sans text-sm text-text-secondary">{effect}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`lower-commission-${tokenId}`}>
          Lower your commission (%)
        </Label>
        <Input
          id={`lower-commission-${tokenId}`}
          inputMode="decimal"
          placeholder={currentPct}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
          className="border-border-default bg-bg-card"
        />
        {invalid && (
          <p className="text-xs text-status-error">
            Enter a value below {currentPct}%. Commission can only be lowered.
          </p>
        )}
      </div>

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

      <Button
        type="button"
        className="w-full"
        disabled={busy || !canSubmit}
        onClick={() => void runLower()}
      >
        {busy ? "Confirming…" : "Lower commission"}
      </Button>
    </>
  );

  if (embedded) {
    return <div className="space-y-3">{body}</div>;
  }

  return (
    <div className="space-y-3 rounded-md border border-border-default bg-bg-surface p-4">
      {body}
    </div>
  );
}
