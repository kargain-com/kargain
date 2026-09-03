"use client";

import { useActiveAccount, requireEvmSession, evmSwitchChainAvailability } from "@/hooks/use-active-account";

import { useCallback, useMemo, useState } from "react";
import { formatUnits, parseUnits } from "viem";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { TX_SYNC_LAG_ADVISORY, useTxSync } from "@/hooks/use-tx-sync";
import {
  lowerFloorConcessionEffect,
} from "@/lib/commerce/compensation-form";
import {
  deriveOwnerLowerFloorConcession,
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
import { useEvmWriteContract } from "@/lib/web3/evm-write-adapter";

type Props = {
  mode: CommerceMode;
  chainId: number;
  tokenId: string;
  /** `undefined` while unresolved — fail closed. */
  live: boolean | undefined;
  isPassportOwner: boolean | undefined;
  /** Snapshotted consignment floor. */
  snapshotFloor: bigint | undefined;
  floorDecimals: number;
  floorUnitLabel: string;
  compensationForm: CompensationForm;
  onChanged?: () => void;
};

function formatFloor(
  amount: bigint,
  decimals: number,
  unit: string,
): string {
  const raw = formatUnits(amount, decimals);
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return `${raw} ${unit}`;
  return `${n.toLocaleString("en-US", { maximumFractionDigits: 8 })} ${unit}`;
}

/**
 * Owner concession: `lowerFloor` on a live consignment snapshot.
 * Availability from {@link deriveOwnerLowerFloorConcession} — mode-agnostic.
 */
export function OwnerLowerFloorPanel({
  mode,
  chainId,
  tokenId,
  live,
  isPassportOwner,
  snapshotFloor,
  floorDecimals,
  floorUnitLabel,
  compensationForm,
  onChanged,
}: Props) {
  const { account, switchChain } = useActiveAccount();
  const evm = requireEvmSession(account);
  const walletChain = evm.ok ? evm.chainId : undefined;
  const switchAvail = evmSwitchChainAvailability(account);

  const wc = wagmiChainId(chainId);
      const { writeContractAsync, isPending } = useEvmWriteContract();
  const { runTx, phase, error, syncLagged } = useTxSync(chainId);
  const busy = isPending || phase !== "idle";

  const market = commerceModeAddress(mode, chainId);
  const abi = commerceModeAbi(mode);
  const tid = useMemo(() => BigInt(tokenId), [tokenId]);
  const wrongChain = evm.ok && walletChain !== chainId;

  const gate = deriveOwnerLowerFloorConcession({
    live,
    isPassportOwner,
    snapshotFloor,
  });

  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [txError, setTxError] = useState<string | null>(null);

  const currentLabel =
    snapshotFloor != null
      ? formatFloor(snapshotFloor, floorDecimals, floorUnitLabel)
      : null;

  const canSubmit = useMemo(() => {
    if (snapshotFloor == null || !input.trim()) return false;
    try {
      const next = parseUnits(input, floorDecimals);
      return next > 0n && next < snapshotFloor;
    } catch {
      return false;
    }
  }, [input, snapshotFloor, floorDecimals]);

  const reset = useCallback(() => {
    setInput("");
    setTxError(null);
  }, []);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) reset();
      setOpen(next);
    },
    [reset],
  );

  const runLower = useCallback(async () => {
    if (!market || !canSubmit || snapshotFloor == null) return;
    if (wrongChain) {
        if (!switchAvail.available) throw new Error(`switchChain unavailable: ${switchAvail.cause}`);
        await switchChain(wc );
      }
    setTxError(null);
    try {
      const newFloor = parseUnits(input, floorDecimals);
      const succeeded = await runTx(() =>
        writeContractAsync({
          address: market,
          abi,
          functionName: "lowerFloor",
          args: [tid, newFloor],
        }),
      );
      if (!succeeded) return;
      onChanged?.();
      handleOpenChange(false);
    } catch (err) {
      setTxError(txErrorMessage(err));
    }
  }, [
    market,
    canSubmit,
    snapshotFloor,
    wrongChain,
    switchChain,
    wc,
    input,
    floorDecimals,
    writeContractAsync,
    abi,
    tid,
    onChanged,
    handleOpenChange,
    runTx, switchAvail]);

  if (!isConcessionAvailable(gate) || !market) return null;

  const effect = lowerFloorConcessionEffect(compensationForm);

  return (
    <div className="space-y-3 rounded-md border border-border-default bg-bg-surface p-4">
      <div className="space-y-1">
        <p className="font-sans text-xs font-medium uppercase tracking-[0.12em] text-text-tertiary">
          Floor
        </p>
        {currentLabel && (
          <p className="font-mono text-sm tabular-nums text-text-primary">
            {currentLabel}
          </p>
        )}
        <p className="font-sans text-sm text-text-secondary">{effect}</p>
      </div>

      {(txError ?? error) && !open && (
        <p className="text-sm text-status-error" role="alert">
          {txError ?? error}
        </p>
      )}
      {syncLagged && !open && (
        <p role="status" className="font-sans text-xs text-text-tertiary">
          {TX_SYNC_LAG_ADVISORY}
        </p>
      )}

      <Button
        type="button"
        variant="secondary"
        className="w-full"
        onClick={() => setOpen(true)}
      >
        Lower floor
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent showClose className="max-w-md">
          <DialogHeader>
            <DialogTitle>Lower floor</DialogTitle>
            <DialogDescription>
              You can only lower the floor. Current floor: {currentLabel}.
            </DialogDescription>
          </DialogHeader>

          <p className="font-sans text-sm text-text-secondary">{effect}</p>

          <div className="space-y-2">
            <Label htmlFor="lower-floor-amount">
              New floor ({floorUnitLabel})
            </Label>
            <input
              id="lower-floor-amount"
              type="text"
              inputMode="decimal"
              placeholder="0"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="min-h-11 w-full rounded-sm border border-border-default bg-bg-card px-4 py-3 font-sans text-sm text-text-primary transition-colors duration-200 placeholder:text-text-tertiary focus:border-accent-warm focus:bg-bg-surface focus:outline-none focus-visible:shadow-[var(--focus-ring)]"
            />
            {input.trim() && !canSubmit && currentLabel && (
              <p className="text-xs text-status-error">
                Enter an amount lower than {currentLabel}.
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

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!canSubmit || busy}
              onClick={() => void runLower()}
            >
              {busy ? "Confirming…" : "Update floor"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
