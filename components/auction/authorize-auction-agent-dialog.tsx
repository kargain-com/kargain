"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { zeroAddress } from "viem";
import {
  useAccount,
  useChainId,
  useReadContract,
  useSwitchChain,
  useWriteContract,
} from "wagmi";

import {
  getVerifierDirectory,
  type VerifierDirectoryEntry,
} from "@/app/actions/verifier-directory";
import { IdentityAvatar } from "@/components/identity/identity-avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { VerifierDirectory } from "@/components/verifier/verifier-directory";
import { TX_SYNC_LAG_ADVISORY, useTxSync } from "@/hooks/use-tx-sync";
import { useMandate } from "@/hooks/use-mandate";
import { usePassportApproval } from "@/hooks/use-passport-approval";
import {
  endsAtDateTimeAttr,
  formatAuctionAmount,
} from "@/lib/auction/format-auction";
import {
  isValidOwnerMinAsset,
  parseOwnerMinAsset,
  type AuctionAssetLabel,
} from "@/lib/auction/owner-min-asset";
import { isZeroAddress } from "@/lib/commerce/consignment";
import {
  COMPENSATION_FORM,
  DENOMINATION_KIND,
  ZERO_CURRENCY_CODE,
} from "@/lib/commerce/denomination";
import { isMandateExpired, mandateHasAgent } from "@/lib/commerce/mandate";
import { commerceModeAddress } from "@/lib/commerce/mode";
import { AscendingConsignmentAbi } from "@/lib/contracts/abis.generated";
import {
  elevatedAdvisoryPanel,
  elevatedAdvisoryText,
  monoTimestamp,
  sansLink,
} from "@/lib/design/instrument-classes";
import { txErrorMessage } from "@/lib/marketplace/tx-error-message";
import { usdcAddress } from "@/lib/web3/deployment-addresses";
import { navShortAddress } from "@/lib/web3/wallet-display";
import { cn } from "@/lib/utils";
import { wagmiChainId } from "@/lib/web3/supported-chains";

type Step = "approval" | "agent" | "terms";

type Props = {
  chainId: number;
  tokenId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional local UI after authorize/revoke (dialog already closes + refetches auth). */
  onAuthorized?: () => void;
  /** When true, show revoke instead of authorize flow. */
  hasActiveAuction?: boolean;
};

function agentDisplayName(entry: VerifierDirectoryEntry): string {
  const trimmed = entry.name.trim();
  return trimmed.length > 0 ? trimmed : navShortAddress(entry.address);
}

function dateInputMin(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString().slice(0, 10);
}

function dateToExpiryUnix(dateStr: string): bigint {
  const [y, m, d] = dateStr.split("-").map(Number);
  const end = new Date(y, m - 1, d, 23, 59, 59);
  return BigInt(Math.floor(end.getTime() / 1000));
}

function isFutureDate(dateStr: string): boolean {
  const expiry = dateToExpiryUnix(dateStr);
  return expiry > BigInt(Math.floor(Date.now() / 1000));
}

export function AuthorizeAuctionAgentDialog({
  chainId,
  tokenId,
  open,
  onOpenChange,
  onAuthorized,
  hasActiveAuction = false,
}: Props) {
  const wc = wagmiChainId(chainId);
  const { address } = useAccount();
  const walletChain = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync, isPending } = useWriteContract();
  const { runTx, awaitReceipt, phase, error, syncLagged } = useTxSync(chainId);

  const mode = commerceModeAddress("ascending", chainId);
  const usdc = usdcAddress(chainId);
  const tid = BigInt(tokenId);
  const wrongChain = walletChain !== wc;
  const busy = isPending || phase !== "idle";

  const [step, setStep] = useState<Step>("approval");
  const [txError, setTxError] = useState<string | null>(null);
  const [verifiers, setVerifiers] = useState<VerifierDirectoryEntry[]>([]);
  const [verifiersLoading, setVerifiersLoading] = useState(false);
  const [selectedAgent, setSelectedAgent] =
    useState<VerifierDirectoryEntry | null>(null);
  const [assetKind, setAssetKind] = useState<AuctionAssetLabel>("ETH");
  const [minAssetInput, setMinAssetInput] = useState("");
  const [noExpiration, setNoExpiration] = useState(true);
  const [expiryDate, setExpiryDate] = useState("");

  const {
    isApproved: isModeApproved,
    approveForAll,
    approveToken,
  } = usePassportApproval({
    chainId,
    tokenId,
    spender: mode,
    enabled: open && Boolean(mode && address),
  });

  const { mandate: chainAuth, refetch: refetchAuth } = useMandate({
    mode: "ascending",
    chainId,
    tokenId,
    enabled: open,
  });

  const { data: unresolvedSettlement } = useReadContract({
    address: mode,
    abi: AscendingConsignmentAbi,
    functionName: "hasUnresolvedSettlement",
    args: [tid],
    chainId: wc,
    query: { enabled: Boolean(open && mode) },
  });

  const { data: protectionEndsAt } = useReadContract({
    address: mode,
    abi: AscendingConsignmentAbi,
    functionName: "holdProtectionEndsAt",
    args: [tid],
    chainId: wc,
    query: { enabled: Boolean(open && mode && unresolvedSettlement === true) },
  });

  const settlementPending = unresolvedSettlement === true;
  const releaseAt = typeof protectionEndsAt === "bigint" ? protectionEndsAt : 0n;
  const settlementDateLabel =
    settlementPending && releaseAt > 0n
      ? new Date(Number(releaseAt) * 1000).toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : null;
  const settlementDateTime =
    settlementPending && releaseAt > 0n
      ? endsAtDateTimeAttr(releaseAt)
      : undefined;

  const nowSec = Math.floor(Date.now() / 1000);
  const authActive = mandateHasAgent(chainAuth);
  const authExpired = isMandateExpired(chainAuth, nowSec);
  const showRevoke = authActive && !hasActiveAuction;

  const displayStep: Step =
    step === "approval" && isModeApproved ? "agent" : step;

  const resetState = useCallback(() => {
    setStep("approval");
    setTxError(null);
    setSelectedAgent(null);
    setAssetKind("ETH");
    setMinAssetInput("");
    setNoExpiration(true);
    setExpiryDate("");
  }, []);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) resetState();
      onOpenChange(next);
    },
    [onOpenChange, resetState],
  );

  useEffect(() => {
    if (!open) return;
    if (isModeApproved) {
      setStep((prev) => (prev === "approval" ? "agent" : prev));
    }
  }, [open, isModeApproved]);

  useEffect(() => {
    if (!open || displayStep !== "agent" || verifiers.length > 0 || showRevoke)
      return;
    let cancelled = false;
    setVerifiersLoading(true);
    void getVerifierDirectory()
      .then(({ verifiers: list }) => {
        if (!cancelled) setVerifiers(list);
      })
      .finally(() => {
        if (!cancelled) setVerifiersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, displayStep, verifiers.length, showRevoke]);

  const runSetApprovalForAll = useCallback(async () => {
    if (!mode) return;
    if (wrongChain) await switchChainAsync?.({ chainId: wc });
    setTxError(null);
    try {
      await approveForAll(awaitReceipt);
      setStep("agent");
    } catch (err) {
      setTxError(txErrorMessage(err));
    }
  }, [mode, wrongChain, switchChainAsync, wc, approveForAll, awaitReceipt]);

  const runApproveToken = useCallback(async () => {
    if (!mode) return;
    if (wrongChain) await switchChainAsync?.({ chainId: wc });
    setTxError(null);
    try {
      await approveToken(awaitReceipt);
      setStep("agent");
    } catch (err) {
      setTxError(txErrorMessage(err));
    }
  }, [mode, wrongChain, switchChainAsync, wc, approveToken, awaitReceipt]);

  const runRevoke = useCallback(async () => {
    if (!mode || hasActiveAuction) return;
    setTxError(null);
    const succeeded = await runTx(() =>
      writeContractAsync({
        address: mode,
        abi: AscendingConsignmentAbi,
        functionName: "revoke",
        args: [tid],
      }),
    );
    if (succeeded) {
      refetchAuth();
      onAuthorized?.();
      handleOpenChange(false);
    }
  }, [
    mode,
    hasActiveAuction,
    writeContractAsync,
    tid,
    runTx,
    refetchAuth,
    onAuthorized,
    handleOpenChange,
  ]);

  const handleSelectAgent = useCallback((entry: VerifierDirectoryEntry) => {
    setSelectedAgent(entry);
    setStep("terms");
    setTxError(null);
  }, []);

  const canSubmitTerms = useMemo(() => {
    if (settlementPending) return false;
    if (!selectedAgent || !mode) return false;
    if (assetKind === "USDC" && !usdc) return false;
    if (!isValidOwnerMinAsset(minAssetInput, assetKind)) return false;
    if (noExpiration) return true;
    return expiryDate !== "" && isFutureDate(expiryDate);
  }, [
    settlementPending,
    selectedAgent,
    mode,
    assetKind,
    usdc,
    minAssetInput,
    noExpiration,
    expiryDate,
  ]);

  const runAuthorize = useCallback(async () => {
    if (!mode || !selectedAgent || !canSubmitTerms) return;
    if (settlementPending) {
      setTxError(
        "The previous sale of this vehicle is still settling. Try again after the hold ends.",
      );
      return;
    }
    setTxError(null);
    const ownerMinAsset = parseOwnerMinAsset(minAssetInput, assetKind);
    if (ownerMinAsset == null) return;
    const asset = assetKind === "ETH" ? zeroAddress : usdc!;
    const expiry = noExpiration ? 0n : dateToExpiryUnix(expiryDate);
    const succeeded = await runTx(() =>
      writeContractAsync({
        address: mode,
        abi: AscendingConsignmentAbi,
        functionName: "grant",
        args: [
          tid,
          selectedAgent.address as `0x${string}`,
          expiry,
          asset,
          // Auction floors are denominated in the settlement asset itself.
          {
            kind: DENOMINATION_KIND.Asset,
            currencyCode: ZERO_CURRENCY_CODE,
          },
          ownerMinAsset,
          { form: COMPENSATION_FORM.Margin, commissionBps: 0 },
        ],
      }),
    );
    if (succeeded) {
      onAuthorized?.();
      handleOpenChange(false);
    }
  }, [
    mode,
    selectedAgent,
    canSubmitTerms,
    settlementPending,
    minAssetInput,
    assetKind,
    usdc,
    noExpiration,
    expiryDate,
    writeContractAsync,
    tid,
    runTx,
    onAuthorized,
    handleOpenChange,
  ]);

  const agentName = selectedAgent ? agentDisplayName(selectedAgent) : "";
  const formattedMin =
    isValidOwnerMinAsset(minAssetInput, assetKind) &&
    parseOwnerMinAsset(minAssetInput, assetKind) != null
      ? formatAuctionAmount(
          parseOwnerMinAsset(minAssetInput, assetKind)!,
          assetKind,
        )
      : null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent showClose className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {showRevoke ? "Auction agent" : "Authorize auction agent"}
          </DialogTitle>
          <DialogDescription>
            {showRevoke
              ? "An agent is authorized to create an auction for this vehicle."
              : "Authorize a KarPro to create a reserve auction on your behalf. Your minimum is locked in the auction currency."}
          </DialogDescription>
        </DialogHeader>

        {settlementPending && settlementDateLabel && (
          <div className={elevatedAdvisoryPanel} role="status">
            <p className={cn("font-sans", elevatedAdvisoryText)}>
              This vehicle’s previous sale is still in its settlement window. You
              can start a new auction after{" "}
              <time
                dateTime={settlementDateTime}
                className={cn(monoTimestamp, elevatedAdvisoryText)}
              >
                {settlementDateLabel}
              </time>
              .
            </p>
          </div>
        )}

        {showRevoke && chainAuth && (
          <div className="space-y-4">
            <div className="rounded-md border border-border-default bg-bg-surface p-3 space-y-1">
              <p className="font-mono text-xs text-text-secondary">
                {navShortAddress(chainAuth.agent)}
                {authExpired ? " · expired" : ""}
              </p>
              <p className="font-mono text-sm tabular-nums text-text-primary">
                Floor{" "}
                {formatAuctionAmount(
                  chainAuth.floor,
                  isZeroAddress(chainAuth.asset) ? "ETH" : "USDC",
                )}
              </p>
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
              variant="outline"
              className="w-full"
              disabled={busy || hasActiveAuction}
              onClick={() => void runRevoke()}
            >
              {phase === "indexing" || busy ? "Confirming…" : "Revoke"}
            </Button>
          </div>
        )}

        {!showRevoke && displayStep === "approval" && !isModeApproved && (
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">
              Approve the ascending consignment contract to hold your passport
              when your agent starts the auction.
            </p>
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
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                disabled={busy}
                onClick={() => void runSetApprovalForAll()}
              >
                {phase === "indexing" || busy
                  ? "Confirming…"
                  : "Approve ascending mode for all passports"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void runApproveToken()}
              >
                {phase === "indexing" || busy
                  ? "Confirming…"
                  : "Approve this passport only"}
              </Button>
            </div>
          </div>
        )}

        {!showRevoke && displayStep === "agent" && !selectedAgent && (
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">
              Choose an active KarPro to manage the auction.
            </p>
            {verifiersLoading ? (
              <div className="space-y-2" role="status" aria-live="polite">
                {Array.from({ length: 4 }).map((_, i) => (
                  <article
                    key={i}
                    className="flex animate-pulse items-center gap-3 rounded-md border border-border-default bg-bg-card p-3"
                    aria-hidden
                  >
                    <div className="size-10 shrink-0 rounded-full bg-bg-surface" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="h-4 w-2/3 rounded bg-bg-surface" />
                      <div className="h-3 w-1/3 rounded bg-bg-surface" />
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="max-h-[50vh] overflow-y-auto">
                <VerifierDirectory
                  verifiers={verifiers}
                  onSelectAgent={handleSelectAgent}
                  layout="picker"
                />
              </div>
            )}
          </div>
        )}

        {!showRevoke && displayStep === "terms" && selectedAgent && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-md border border-border-default bg-bg-surface p-3">
              <IdentityAvatar
                address={selectedAgent.address}
                size={40}
                alt={agentName}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-sans text-sm font-medium text-text-primary">
                  {agentName}
                </p>
                <p className="font-sans text-xs text-text-secondary">
                  Selected agent
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedAgent(null);
                  setStep("agent");
                }}
                className={cn(
                  sansLink,
                  "shrink-0 text-xs underline-offset-2 hover:underline",
                )}
              >
                Change
              </button>
            </div>

            <div className="space-y-2">
              <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-text-tertiary">
                Auction currency
              </p>
              <div className="flex gap-2">
                {(["ETH", "USDC"] as const).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => setAssetKind(kind)}
                    className={cn(
                      "min-h-11 flex-1 rounded-sm border px-3 font-sans text-sm font-medium transition-colors",
                      "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
                      assetKind === kind
                        ? "border-border-hover bg-bg-primary text-text-primary"
                        : "border-border-default text-text-secondary hover:border-border-hover",
                    )}
                  >
                    {kind}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="auction-owner-min">
                Minimum you&apos;ll receive ({assetKind})
              </Label>
              <input
                id="auction-owner-min"
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={minAssetInput}
                onChange={(e) => setMinAssetInput(e.target.value)}
                className="min-h-11 w-full rounded-sm border border-border-default bg-bg-card px-4 py-3 font-mono text-sm tabular-nums text-text-primary transition-colors duration-200 placeholder:text-text-tertiary focus:border-accent-warm focus:bg-bg-surface focus:outline-none focus-visible:shadow-[var(--focus-ring)]"
              />
              <p className="text-xs text-text-secondary">
                Your minimum is in the auction currency ({assetKind}), not a
                display price. You receive at least this amount after all fees.
              </p>
            </div>

            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <Checkbox
                  id="auction-agent-no-expiry"
                  checked={noExpiration}
                  onCheckedChange={(v) => setNoExpiration(v === true)}
                />
                <Label
                  htmlFor="auction-agent-no-expiry"
                  className="text-sm leading-snug text-text-primary"
                >
                  No expiration
                </Label>
              </div>
              {!noExpiration && (
                <div className="space-y-2">
                  <Label htmlFor="auction-agent-expiry">
                    Authorization expires
                  </Label>
                  <input
                    id="auction-agent-expiry"
                    type="date"
                    min={dateInputMin()}
                    value={expiryDate}
                    onChange={(e) => setExpiryDate(e.target.value)}
                    className="min-h-11 w-full rounded-sm border border-border-default bg-bg-card px-4 py-3 font-sans text-sm text-text-primary transition-colors duration-200 focus:border-accent-warm focus:bg-bg-surface focus:outline-none focus-visible:shadow-[var(--focus-ring)]"
                  />
                  {expiryDate && !isFutureDate(expiryDate) && (
                    <p className="text-xs text-status-error">
                      Choose a future date.
                    </p>
                  )}
                </div>
              )}
            </div>

            {formattedMin && (
              <p className="rounded-md border border-border-default bg-bg-surface p-4 text-sm text-text-secondary">
                {agentName} can create an auction in {assetKind}. You are
                guaranteed at least{" "}
                <span className="font-mono tabular-nums text-text-primary">
                  {formattedMin}
                </span>{" "}
                after their fee and platform fees.
              </p>
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
                disabled={!canSubmitTerms || busy}
                onClick={() => void runAuthorize()}
              >
                {phase === "indexing" || busy ? "Confirming…" : "Authorize agent"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
