"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { parseUnits } from "viem";
import { useChainId, useSwitchChain, useWriteContract } from "wagmi";

import { IdentityAvatar } from "@/components/identity/identity-avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { usePeerIdentity } from "@/hooks/use-peer-identity";
import { TX_SYNC_LAG_ADVISORY, useTxSync } from "@/hooks/use-tx-sync";
import type { MandateSnapshot } from "@/lib/commerce/mandate";
import { commerceModeAddress } from "@/lib/commerce/mode";
import { FixedPriceConsignmentAbi } from "@/lib/contracts/abis.generated";
import { categoryLabel } from "@/lib/design/instrument-classes";
import { listingCurrencyCodesForChain } from "@/lib/marketplace/currency-code";
import { formatFiat1e8 } from "@/lib/marketplace/fiat-format";
import { txErrorMessage } from "@/lib/marketplace/tx-error-message";
import { wagmiChainId } from "@/lib/web3/supported-chains";

type Props = {
  chainId: number;
  tokenId: string;
  /** Fixed-price mandate read from the mode contract. */
  mandate: MandateSnapshot;
  /** A live consignment blocks revoke — recall it first. */
  listingActive: boolean;
  onChanged: () => void;
};

function formatExpiry(expiry: number): string {
  if (expiry === 0) return "No expiration";
  return new Date(expiry * 1000).toLocaleDateString();
}

export function AgentAuthorizationStatus({
  chainId,
  tokenId,
  mandate,
  listingActive,
  onChanged,
}: Props) {
  const wc = wagmiChainId(chainId);
  const walletChain = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync, isPending } = useWriteContract();
  const { runTx, phase, error, syncLagged } = useTxSync(chainId);
  const busy = isPending || phase !== "idle";

  const market = commerceModeAddress("fixedPrice", chainId);
  const tid = BigInt(tokenId);
  const wrongChain = walletChain !== chainId;

  // The mandate stores its own denomination; this label reflects the codes the
  // chain can settle today.
  const currencyCode = listingCurrencyCodesForChain(chainId)[0] ?? "USD";
  const { displayName, isKarPro, profileHref } = usePeerIdentity(mandate.agent);

  const [lowerOpen, setLowerOpen] = useState(false);
  const [lowerInput, setLowerInput] = useState("");
  const [txError, setTxError] = useState<string | null>(null);

  const currentMin = mandate.floor;

  const resetLowerDialog = useCallback(() => {
    setLowerInput("");
    setTxError(null);
  }, []);

  const handleLowerOpenChange = useCallback(
    (open: boolean) => {
      if (!open) resetLowerDialog();
      setLowerOpen(open);
    },
    [resetLowerDialog],
  );

  const canSubmitLower = (() => {
    if (!lowerInput.trim()) return false;
    try {
      const next = parseUnits(lowerInput, 8);
      return next > 0n && next < currentMin;
    } catch {
      return false;
    }
  })();

  const runLowerMin = useCallback(async () => {
    if (!market || !canSubmitLower) return;
    if (wrongChain) await switchChainAsync?.({ chainId: wc });
    setTxError(null);
    try {
      const newMin = parseUnits(lowerInput, 8);
      const succeeded = await runTx(() =>
        writeContractAsync({
          address: market,
          abi: FixedPriceConsignmentAbi,
          functionName: "lowerFloor",
          args: [tid, newMin],
        }),
      );
      if (!succeeded) return;
      onChanged();
      handleLowerOpenChange(false);
    } catch (err) {
      setTxError(txErrorMessage(err));
    }
  }, [
    market,
    canSubmitLower,
    wrongChain,
    switchChainAsync,
    wc,
    lowerInput,
    writeContractAsync,
    tid,
    onChanged,
    handleLowerOpenChange,
    runTx,
  ]);

  const runRevoke = useCallback(async () => {
    if (!market || listingActive) return;
    if (wrongChain) await switchChainAsync?.({ chainId: wc });
    setTxError(null);
    try {
      const succeeded = await runTx(() =>
        writeContractAsync({
          address: market,
          abi: FixedPriceConsignmentAbi,
          functionName: "revoke",
          args: [tid],
        }),
      );
      if (!succeeded) return;
      onChanged();
    } catch (err) {
      setTxError(txErrorMessage(err));
    }
  }, [
    market,
    listingActive,
    wrongChain,
    switchChainAsync,
    wc,
    writeContractAsync,
    tid,
    onChanged,
    runTx,
  ]);

  return (
    <div className="space-y-4 rounded-md border border-border-default bg-bg-surface p-4">
      <div>
        <p className="font-sans text-xs font-medium uppercase tracking-[0.12em] text-text-tertiary">
          Delegated to
        </p>
        <div className="mt-2 flex items-center gap-3">
          <IdentityAvatar address={mandate.agent} size={40} alt={displayName} />
          <div className="min-w-0">
            <Link
              href={profileHref}
              className="truncate font-sans text-sm font-medium text-text-primary underline-offset-2 hover:text-accent-warm hover:underline"
            >
              {displayName}
            </Link>
            {isKarPro && (
              <p className={categoryLabel}>
                KarPro
              </p>
            )}
          </div>
        </div>
      </div>

      <dl className="space-y-2 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-text-secondary">
            Minimum you&apos;ll receive ({currencyCode})
          </dt>
          <dd className="font-mono tabular-nums text-text-primary">
            {formatFiat1e8(currentMin)} {currencyCode}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-text-secondary">Authorization</dt>
          <dd className="text-text-primary">{formatExpiry(mandate.expiry)}</dd>
        </div>
      </dl>

      {(txError ?? error) && !lowerOpen && (
        <p className="text-sm text-status-error" role="alert">
          {txError ?? error}
        </p>
      )}
      {syncLagged && !lowerOpen && (
        <p role="status" className="font-sans text-xs text-text-tertiary">
          {TX_SYNC_LAG_ADVISORY}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          onClick={() => setLowerOpen(true)}
        >
          Lower minimum
        </Button>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={listingActive || busy}
          onClick={() => void runRevoke()}
        >
          {busy ? "Confirming…" : "Revoke agent"}
        </Button>
        {listingActive && (
          <p className="text-center text-xs text-text-secondary">
            Return the vehicle from the agent before revoking access
          </p>
        )}
      </div>

      <Dialog open={lowerOpen} onOpenChange={handleLowerOpenChange}>
        <DialogContent showClose className="max-w-md">
          <DialogHeader>
            <DialogTitle>Lower minimum price</DialogTitle>
            <DialogDescription>
              You can only lower your minimum. Current minimum: {formatFiat1e8(currentMin)}{" "}
              {currencyCode}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="lower-min-price">New minimum ({currencyCode})</Label>
            <input
              id="lower-min-price"
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={lowerInput}
              onChange={(e) => setLowerInput(e.target.value)}
              className="min-h-11 w-full rounded-sm border border-border-default bg-bg-card px-4 py-3 font-sans text-sm text-text-primary transition-colors duration-200 placeholder:text-text-tertiary focus:border-accent-warm focus:bg-bg-surface focus:outline-none focus-visible:shadow-[var(--focus-ring)]"
            />
            {lowerInput.trim() && !canSubmitLower && (
              <p className="text-xs text-status-error">
                Enter an amount lower than {formatFiat1e8(currentMin)} {currencyCode}.
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
            <Button type="button" variant="outline" onClick={() => handleLowerOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!canSubmitLower || busy}
              onClick={() => void runLowerMin()}
            >
              {busy ? "Confirming…" : "Update minimum"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
