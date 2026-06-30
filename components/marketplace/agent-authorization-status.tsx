"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { parseUnits } from "viem";
import { waitForTransactionReceipt } from "wagmi/actions";
import {
  useChainId,
  useConfig,
  useSwitchChain,
  useWriteContract,
} from "wagmi";

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
import { MarketplaceEscrowAbi } from "@/lib/contracts/abis.generated";
import { listingCurrencyCodesForChain } from "@/lib/marketplace/currency-code";
import { formatFiat1e8 } from "@/lib/marketplace/fiat-format";
import { txErrorMessage } from "@/lib/marketplace/tx-error-message";
import { marketplaceAddress } from "@/lib/web3/deployment-addresses";
import { wagmiChainId } from "@/lib/web3/supported-chains";

type AgentAuth = {
  agent: `0x${string}`;
  expiry: bigint;
  ownerMinPrice1e8: bigint;
  active: boolean;
};

type Props = {
  chainId: number;
  tokenId: string;
  agentAuth: AgentAuth;
  listingActive: boolean;
  onChanged: () => void;
};

function formatExpiry(expiry: bigint): string {
  if (expiry === 0n) return "No expiration";
  return new Date(Number(expiry) * 1000).toLocaleDateString();
}

export function AgentAuthorizationStatus({
  chainId,
  tokenId,
  agentAuth,
  listingActive,
  onChanged,
}: Props) {
  const config = useConfig();
  const wc = wagmiChainId(chainId);
  const walletChain = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync, isPending } = useWriteContract();

  const market = marketplaceAddress(chainId);
  const tid = BigInt(tokenId);
  const wrongChain = walletChain !== chainId;

  const currencyCode = listingCurrencyCodesForChain(chainId)[0] ?? "USD";
  const { displayName, isKarPro, profileHref } = usePeerIdentity(agentAuth.agent);

  const [lowerOpen, setLowerOpen] = useState(false);
  const [lowerInput, setLowerInput] = useState("");
  const [txError, setTxError] = useState<string | null>(null);

  const currentMin = agentAuth.ownerMinPrice1e8;

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
      const hash = await writeContractAsync({
        address: market,
        abi: MarketplaceEscrowAbi,
        functionName: "updateOwnerMinPrice",
        args: [tid, newMin],
      });
      await waitForTransactionReceipt(config, { hash });
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
    config,
    onChanged,
    handleLowerOpenChange,
  ]);

  const runRevoke = useCallback(async () => {
    if (!market || listingActive) return;
    if (wrongChain) await switchChainAsync?.({ chainId: wc });
    setTxError(null);
    try {
      const hash = await writeContractAsync({
        address: market,
        abi: MarketplaceEscrowAbi,
        functionName: "revokeAgent",
        args: [tid],
      });
      await waitForTransactionReceipt(config, { hash });
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
    config,
    onChanged,
  ]);

  return (
    <div className="space-y-4 rounded-md border border-border-default bg-bg-surface p-4">
      <div>
        <p className="font-sans text-xs font-medium uppercase tracking-[0.12em] text-text-tertiary">
          Delegated to
        </p>
        <div className="mt-2 flex items-center gap-3">
          <IdentityAvatar address={agentAuth.agent} size={40} alt={displayName} />
          <div className="min-w-0">
            <Link
              href={profileHref}
              className="truncate font-sans text-sm font-medium text-text-primary underline-offset-2 hover:text-accent-warm hover:underline"
            >
              {displayName}
            </Link>
            {isKarPro && (
              <p className="font-mono text-xs font-medium tracking-[0.18em] uppercase text-accent-warm">
                KarPro
              </p>
            )}
          </div>
        </div>
      </div>

      <dl className="space-y-2 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-text-secondary">Minimum you receive</dt>
          <dd className="font-mono tabular-nums text-text-primary">
            {formatFiat1e8(currentMin)} {currencyCode}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-text-secondary">Authorization</dt>
          <dd className="text-text-primary">{formatExpiry(agentAuth.expiry)}</dd>
        </div>
      </dl>

      {txError && !lowerOpen && (
        <p className="text-sm text-status-error" role="alert">
          {txError}
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
          disabled={listingActive || isPending}
          onClick={() => void runRevoke()}
        >
          Revoke agent
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

          {txError && (
            <p className="text-sm text-status-error" role="alert">
              {txError}
            </p>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => handleLowerOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!canSubmitLower || isPending}
              onClick={() => void runLowerMin()}
            >
              Update minimum
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
