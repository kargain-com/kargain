"use client";

import { useActiveAccount, requireEvmSession, evmSwitchChainAvailability } from "@/hooks/use-active-account";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits, parseUnits, zeroAddress } from "viem";
import { useReadContract } from "wagmi";

import { getVerifierDirectory } from "@/app/actions/verifier-directory";
import type { VerifierDirectoryEntry } from "@/lib/verifier/parse-directory-entry";
import { MandateCompensationFields } from "@/components/commerce/mandate-compensation-fields";
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
import { useOpenableTerms } from "@/hooks/use-openable-terms";
import { TX_SYNC_LAG_ADVISORY, useTxSync } from "@/hooks/use-tx-sync";
import { useMandate } from "@/hooks/use-mandate";
import { usePassportApproval } from "@/hooks/use-passport-approval";
import { endsAtDateTimeAttr } from "@/lib/auction/format-auction";
import { isZeroAddress } from "@/lib/commerce/consignment";
import {
  buildCompensation,
  compensationFormDef,
} from "@/lib/commerce/compensation-form";
import {
  COMPENSATION_FORM,
  DENOMINATION_KIND,
  ZERO_CURRENCY_CODE,
  type CompensationForm,
} from "@/lib/commerce/denomination";
import { isMandateExpired, mandateHasAgent } from "@/lib/commerce/mandate";
import { commerceModeAddress } from "@/lib/commerce/mode";
import { gateOpenablePairing } from "@/lib/commerce/openable-terms";
import { AscendingConsignmentAbi } from "@/lib/contracts/abis.generated";
import {
  elevatedAdvisoryPanel,
  elevatedAdvisoryText,
  monoTimestamp,
  sansLink,
} from "@/lib/design/instrument-classes";
import { txErrorMessage } from "@/lib/marketplace/tx-error-message";
import { navShortAddress } from "@/lib/web3/wallet-display";
import { cn } from "@/lib/utils";
import { wagmiChainId } from "@/lib/web3/supported-chains";
import { useEvmWriteContract } from "@/lib/web3/evm-write-adapter";

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

function formatFloorAmount(
  amount: bigint,
  decimals: number,
  label: string,
): string {
  const raw = formatUnits(amount, decimals);
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return `${raw} ${label}`;
  return `${n.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${label}`;
}

export function AuthorizeAuctionAgentDialog({
  chainId,
  tokenId,
  open,
  onOpenChange,
  onAuthorized,
  hasActiveAuction = false,
}: Props) {
  const { account, switchChain } = useActiveAccount();
  const evm = requireEvmSession(account);
  const address = evm.ok ? evm.address : undefined;
  const walletChain = evm.ok ? evm.chainId : undefined;
  const switchAvail = evmSwitchChainAvailability(account);

  const wc = wagmiChainId(chainId);
        const { writeContractAsync, isPending } = useEvmWriteContract();
  const { runTx, awaitReceipt, phase, error, syncLagged } = useTxSync(chainId);

  const mode = commerceModeAddress("ascending", chainId);
  const tid = BigInt(tokenId);
  const wrongChain = walletChain !== wc;
  const busy = isPending || phase !== "idle";

  const { options: openOptions, pending: openOptionsPending } =
    useOpenableTerms(chainId, "ascending");

  const [step, setStep] = useState<Step>("approval");
  const [txError, setTxError] = useState<string | null>(null);
  const [verifiers, setVerifiers] = useState<VerifierDirectoryEntry[]>([]);
  const [verifiersLoading, setVerifiersLoading] = useState(false);
  const [selectedAgent, setSelectedAgent] =
    useState<VerifierDirectoryEntry | null>(null);
  const [settlementAsset, setSettlementAsset] = useState<`0x${string}`>(
    zeroAddress,
  );
  const [compensationForm, setCompensationForm] = useState<CompensationForm>(
    COMPENSATION_FORM.Commission,
  );
  const [commissionPercent, setCommissionPercent] = useState("5");
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

  const selectedAsset = useMemo(
    () =>
      openOptions.assets.find(
        (a) => a.token.toLowerCase() === settlementAsset.toLowerCase(),
      ),
    [openOptions.assets, settlementAsset],
  );

  useEffect(() => {
    if (!openOptions.available || openOptions.assets.length === 0) return;
    const stillValid = openOptions.assets.some(
      (a) => a.token.toLowerCase() === settlementAsset.toLowerCase(),
    );
    if (!stillValid) {
      setSettlementAsset(openOptions.assets[0]!.token as `0x${string}`);
    }
  }, [openOptions, settlementAsset]);

  const resetState = useCallback(() => {
    setStep("approval");
    setTxError(null);
    setSelectedAgent(null);
    setSettlementAsset(zeroAddress as `0x${string}`);
    setCompensationForm(COMPENSATION_FORM.Commission);
    setCommissionPercent("5");
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
    if (wrongChain) {
        if (!switchAvail.available) throw new Error(`switchChain unavailable: ${switchAvail.cause}`);
        await switchChain(wc );
      }
    setTxError(null);
    try {
      await approveForAll(awaitReceipt);
      setStep("agent");
    } catch (err) {
      setTxError(txErrorMessage(err));
    }
  }, [mode, wrongChain, switchChain, wc, approveForAll, awaitReceipt, switchAvail]);

  const runApproveToken = useCallback(async () => {
    if (!mode) return;
    if (wrongChain) {
        if (!switchAvail.available) throw new Error(`switchChain unavailable: ${switchAvail.cause}`);
        await switchChain(wc );
      }
    setTxError(null);
    try {
      await approveToken(awaitReceipt);
      setStep("agent");
    } catch (err) {
      setTxError(txErrorMessage(err));
    }
  }, [mode, wrongChain, switchChain, wc, approveToken, awaitReceipt, switchAvail]);

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

  const pairingGate = useMemo(
    () =>
      gateOpenablePairing(openOptions, {
        asset: settlementAsset,
        denominationKind: DENOMINATION_KIND.Asset,
      }),
    [openOptions, settlementAsset],
  );

  const compensationBuilt = useMemo(
    () =>
      buildCompensation({
        form: compensationForm,
        commissionPercent:
          compensationForm === COMPENSATION_FORM.Commission
            ? commissionPercent
            : null,
      }),
    [compensationForm, commissionPercent],
  );

  const floorParsed = useMemo(() => {
    if (!selectedAsset || !minAssetInput.trim()) return null;
    try {
      const amount = parseUnits(minAssetInput.trim(), selectedAsset.decimals);
      return amount > 0n ? amount : null;
    } catch {
      return null;
    }
  }, [selectedAsset, minAssetInput]);

  const canSubmitTerms = useMemo(() => {
    if (settlementPending) return false;
    if (!selectedAgent || !mode) return false;
    if (!openOptions.available || openOptionsPending) return false;
    if (!pairingGate.available) return false;
    if (floorParsed == null) return false;
    if ("ok" in compensationBuilt && compensationBuilt.ok === false) return false;
    if (noExpiration) return true;
    return expiryDate !== "" && isFutureDate(expiryDate);
  }, [
    settlementPending,
    selectedAgent,
    mode,
    openOptions.available,
    openOptionsPending,
    pairingGate,
    floorParsed,
    compensationBuilt,
    noExpiration,
    expiryDate,
  ]);

  const runAuthorize = useCallback(async () => {
    if (!mode || !selectedAgent || !canSubmitTerms || floorParsed == null) return;
    if (settlementPending) {
      setTxError(
        "The previous sale of this vehicle is still settling. Try again after the hold ends.",
      );
      return;
    }
    if ("ok" in compensationBuilt && compensationBuilt.ok === false) {
      setTxError(compensationBuilt.reason);
      return;
    }
    if (!pairingGate.available) {
      setTxError(pairingGate.cause);
      return;
    }
    setTxError(null);
    const expiry = noExpiration ? 0n : dateToExpiryUnix(expiryDate);
    const compensation =
      "form" in compensationBuilt
        ? compensationBuilt
        : { form: COMPENSATION_FORM.Margin, commissionBps: 0 };
    const succeeded = await runTx(() =>
      writeContractAsync({
        address: mode,
        abi: AscendingConsignmentAbi,
        functionName: "grant",
        args: [
          tid,
          selectedAgent.address as `0x${string}`,
          expiry,
          settlementAsset as `0x${string}`,
          {
            kind: DENOMINATION_KIND.Asset,
            currencyCode: ZERO_CURRENCY_CODE,
          },
          floorParsed,
          compensation,
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
    floorParsed,
    settlementPending,
    compensationBuilt,
    pairingGate,
    noExpiration,
    expiryDate,
    settlementAsset,
    writeContractAsync,
    tid,
    runTx,
    onAuthorized,
    handleOpenChange,
  ]);

  const agentName = selectedAgent ? agentDisplayName(selectedAgent) : "";
  const assetLabel = selectedAsset?.label ?? "asset";
  const formattedMin =
    floorParsed != null && selectedAsset
      ? formatFloorAmount(floorParsed, selectedAsset.decimals, assetLabel)
      : null;
  const compensationConsequence = compensationFormDef(compensationForm).consequence;

  const revokeAsset = chainAuth
    ? openOptions.assets.find(
        (a) => a.token.toLowerCase() === chainAuth.asset.toLowerCase(),
      )
    : undefined;
  const revokeFloorLabel = chainAuth
    ? formatFloorAmount(
        chainAuth.floor,
        revokeAsset?.decimals ?? (isZeroAddress(chainAuth.asset) ? 18 : 6),
        revokeAsset?.label ??
          (isZeroAddress(chainAuth.asset) ? "ETH" : "token"),
      )
    : null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent showClose className="max-w-lg max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {showRevoke ? "Auction agent" : "Authorize auction agent"}
          </DialogTitle>
          <DialogDescription>
            {showRevoke
              ? "An agent is authorized to create an auction for this vehicle."
              : "Authorize a KarPro to create a reserve auction on your behalf. You choose the settlement asset, floor, and compensation."}
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
                Floor {revokeFloorLabel}
              </p>
              <p className="font-sans text-xs text-text-secondary">
                {compensationFormDef(chainAuth.compensationForm).label}
                {chainAuth.compensationForm === COMPENSATION_FORM.Commission
                  ? ` · ${(chainAuth.commissionBps / 100).toFixed(2)}%`
                  : ""}
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
                  lockedChainId={chainId}
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

            {!openOptions.available && !openOptionsPending ? (
              <p className="font-sans text-sm text-text-secondary" role="status">
                {openOptions.unavailableReason}
              </p>
            ) : (
              <div className="space-y-2">
                <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-text-tertiary">
                  Settlement asset
                </p>
                <div className="flex flex-wrap gap-2">
                  {openOptions.assets.map((asset) => (
                    <button
                      key={asset.token}
                      type="button"
                      onClick={() =>
                        setSettlementAsset(asset.token as `0x${string}`)
                      }
                      disabled={busy || openOptionsPending}
                      className={cn(
                        "min-h-11 flex-1 rounded-sm border px-3 font-sans text-sm font-medium transition-colors",
                        "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
                        settlementAsset.toLowerCase() ===
                          asset.token.toLowerCase()
                          ? "border-border-hover bg-bg-primary text-text-primary"
                          : "border-border-default text-text-secondary hover:border-border-hover",
                      )}
                    >
                      {asset.label}
                    </button>
                  ))}
                </div>
                <p className="font-sans text-xs text-text-secondary">
                  Ascending floors are denominated in the settlement asset.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="auction-owner-min">
                Minimum you&apos;ll receive ({assetLabel})
              </Label>
              <input
                id="auction-owner-min"
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={minAssetInput}
                onChange={(e) => setMinAssetInput(e.target.value)}
                disabled={!openOptions.available}
                className="min-h-11 w-full rounded-sm border border-border-default bg-bg-card px-4 py-3 font-mono text-sm tabular-nums text-text-primary transition-colors duration-200 placeholder:text-text-tertiary focus:border-accent-warm focus:bg-bg-surface focus:outline-none focus-visible:shadow-[var(--focus-ring)]"
              />
            </div>

            <MandateCompensationFields
              form={compensationForm}
              onFormChange={setCompensationForm}
              commissionPercent={commissionPercent}
              onCommissionPercentChange={setCommissionPercent}
              disabled={busy || !openOptions.available}
              tip="Commission is the natural pairing for ascending sales — the market creates the upside, so it belongs to you. Either form may be granted."
            />

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
                {agentName} can create an auction in {assetLabel}. Your floor is{" "}
                <span className="font-mono tabular-nums text-text-primary">
                  {formattedMin}
                </span>
                . {compensationConsequence}
              </p>
            )}

            {!pairingGate.available && openOptions.available ? (
              <p className="text-sm text-status-error" role="alert">
                {pairingGate.cause}
              </p>
            ) : null}

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
