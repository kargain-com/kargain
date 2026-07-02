"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { parseUnits } from "viem";
import { waitForTransactionReceipt } from "wagmi/actions";
import {
  useAccount,
  useChainId,
  useConfig,
  useReadContracts,
  useSwitchChain,
  useWriteContract,
} from "wagmi";

import { getVerifierDirectory, type VerifierDirectoryEntry } from "@/app/actions/verifier-directory";
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
import { KarPassportAbi, MarketplaceEscrowAbi } from "@/lib/contracts/abis.generated";
import {
  listingCurrencyCodesForChain,
  type ListingCurrencyCode,
} from "@/lib/marketplace/currency-code";
import { formatFiat1e8 } from "@/lib/marketplace/fiat-format";
import { txErrorMessage } from "@/lib/marketplace/tx-error-message";
import {
  karPassportAddress,
  marketplaceAddress,
} from "@/lib/web3/deployment-addresses";
import { navShortAddress } from "@/lib/web3/wallet-display";
import { wagmiChainId } from "@/lib/web3/supported-chains";

type Step = "approval" | "agent" | "terms";

type Props = {
  chainId: number;
  tokenId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAuthorized: () => void;
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

function formatListingPrice(amount: bigint, code: ListingCurrencyCode): string {
  const value = formatFiat1e8(amount);
  if (code === "USD") return `$${value}`;
  if (code === "EUR") return `€${value}`;
  if (code === "JPY") return `¥${value}`;
  return `${value} ${code}`;
}

export function AuthorizeAgentDialog({
  chainId,
  tokenId,
  open,
  onOpenChange,
  onAuthorized,
}: Props) {
  const config = useConfig();
  const wc = wagmiChainId(chainId);
  const { address } = useAccount();
  const walletChain = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync, isPending } = useWriteContract();

  const passport = karPassportAddress(chainId);
  const market = marketplaceAddress(chainId);
  const tid = BigInt(tokenId);
  const wrongChain = walletChain !== chainId;

  // UI label only: on this chain, agents can only list in these currencies today.
  // The contract does NOT store currency on authorizeAgent — ownerMinPrice1e8 is a raw
  // scalar compared in whatever currency the agent picks at listOnBehalf.
  const chainListingCurrency = listingCurrencyCodesForChain(chainId)[0] ?? "USD";

  const [step, setStep] = useState<Step>("approval");
  const [txError, setTxError] = useState<string | null>(null);
  const [verifiers, setVerifiers] = useState<VerifierDirectoryEntry[]>([]);
  const [verifiersLoading, setVerifiersLoading] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<VerifierDirectoryEntry | null>(null);
  const [minPriceInput, setMinPriceInput] = useState("");
  const [noExpiration, setNoExpiration] = useState(true);
  const [expiryDate, setExpiryDate] = useState("");

  const { data: approvalReads, refetch: refetchApproval } = useReadContracts({
    contracts:
      passport && market && address
        ? [
            {
              address: passport,
              abi: KarPassportAbi,
              functionName: "getApproved",
              args: [tid],
              chainId: wc,
            },
            {
              address: passport,
              abi: KarPassportAbi,
              functionName: "isApprovedForAll",
              args: [address, market],
              chainId: wc,
            },
          ]
        : [],
    query: { enabled: open },
  });

  const approvedForToken =
    market &&
    approvalReads?.[0]?.result &&
    (approvalReads[0].result as string).toLowerCase() === market.toLowerCase();
  const approvedForAll = approvalReads?.[1]?.result === true;
  const isMarketplaceApproved = Boolean(approvedForToken || approvedForAll);

  const displayStep: Step =
    step === "approval" && isMarketplaceApproved ? "agent" : step;

  const resetState = useCallback(() => {
    setStep("approval");
    setTxError(null);
    setSelectedAgent(null);
    setMinPriceInput("");
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
    if (isMarketplaceApproved) {
      setStep((prev) => (prev === "approval" ? "agent" : prev));
    }
  }, [open, isMarketplaceApproved]);

  useEffect(() => {
    if (!open || step !== "agent" || verifiers.length > 0) return;
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
  }, [open, step, verifiers.length]);

  const runSetApprovalForAll = useCallback(async () => {
    if (!passport || !market) return;
    if (wrongChain) await switchChainAsync?.({ chainId: wc });
    setTxError(null);
    try {
      const hash = await writeContractAsync({
        address: passport,
        abi: KarPassportAbi,
        functionName: "setApprovalForAll",
        args: [market, true],
      });
      await waitForTransactionReceipt(config, { hash });
      await refetchApproval();
      setStep("agent");
    } catch (err) {
      setTxError(txErrorMessage(err));
    }
  }, [
    passport,
    market,
    wrongChain,
    switchChainAsync,
    wc,
    writeContractAsync,
    config,
    refetchApproval,
  ]);

  const runApproveToken = useCallback(async () => {
    if (!passport || !market) return;
    if (wrongChain) await switchChainAsync?.({ chainId: wc });
    setTxError(null);
    try {
      const hash = await writeContractAsync({
        address: passport,
        abi: KarPassportAbi,
        functionName: "approve",
        args: [market, tid],
      });
      await waitForTransactionReceipt(config, { hash });
      await refetchApproval();
      setStep("agent");
    } catch (err) {
      setTxError(txErrorMessage(err));
    }
  }, [
    passport,
    market,
    wrongChain,
    switchChainAsync,
    wc,
    writeContractAsync,
    config,
    tid,
    refetchApproval,
  ]);

  const handleSelectAgent = useCallback((entry: VerifierDirectoryEntry) => {
    setSelectedAgent(entry);
    setStep("terms");
    setTxError(null);
  }, []);

  const formattedMinPrice = useMemo(() => {
    if (!minPriceInput.trim()) return null;
    try {
      const amount = parseUnits(minPriceInput, 8);
      if (amount <= 0n) return null;
      return formatListingPrice(amount, chainListingCurrency);
    } catch {
      return null;
    }
  }, [minPriceInput, chainListingCurrency]);

  const canSubmitTerms = useMemo(() => {
    if (!selectedAgent || !market) return false;
    try {
      const amount = parseUnits(minPriceInput || "0", 8);
      if (amount <= 0n) return false;
    } catch {
      return false;
    }
    if (noExpiration) return true;
    return expiryDate !== "" && isFutureDate(expiryDate);
  }, [selectedAgent, market, minPriceInput, noExpiration, expiryDate]);

  const runAuthorize = useCallback(async () => {
    if (!market || !selectedAgent || !canSubmitTerms) return;
    if (wrongChain) await switchChainAsync?.({ chainId: wc });
    setTxError(null);
    try {
      const ownerMinPrice = parseUnits(minPriceInput, 8);
      const expiry = noExpiration ? 0n : dateToExpiryUnix(expiryDate);
      const hash = await writeContractAsync({
        address: market,
        abi: MarketplaceEscrowAbi,
        functionName: "authorizeAgent",
        args: [tid, selectedAgent.address, expiry, ownerMinPrice],
      });
      await waitForTransactionReceipt(config, { hash });
      onAuthorized();
      handleOpenChange(false);
    } catch (err) {
      setTxError(txErrorMessage(err));
    }
  }, [
    market,
    selectedAgent,
    canSubmitTerms,
    wrongChain,
    switchChainAsync,
    wc,
    minPriceInput,
    noExpiration,
    expiryDate,
    writeContractAsync,
    tid,
    config,
    onAuthorized,
    handleOpenChange,
  ]);

  const agentName = selectedAgent ? agentDisplayName(selectedAgent) : "";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent showClose className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Delegate to a pro</DialogTitle>
          <DialogDescription>
            Authorize a KarPro to list and sell your vehicle on your behalf. You set a minimum
            net amount; it applies once your agent lists the vehicle.
          </DialogDescription>
        </DialogHeader>

        {displayStep === "approval" && !isMarketplaceApproved && (
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">
              Before delegating, approve the marketplace contract to hold your passport when your
              agent lists it for sale. This avoids surprises when they try to list on your behalf.
            </p>
            {txError && (
              <p className="text-sm text-status-error" role="alert">
                {txError}
              </p>
            )}
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                disabled={isPending}
                onClick={() => void runSetApprovalForAll()}
              >
                Approve marketplace for all passports
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={isPending}
                onClick={() => void runApproveToken()}
              >
                Approve this passport only
              </Button>
            </div>
          </div>
        )}

        {displayStep === "agent" && !selectedAgent && (
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">
              Choose an active KarPro to manage the sale.
            </p>
            {verifiersLoading ? (
              <div className="space-y-2" role="status" aria-live="polite">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-14 animate-pulse rounded-md border border-border-default bg-bg-surface"
                    aria-hidden
                  />
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

        {displayStep === "terms" && selectedAgent && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-md border border-border-default bg-bg-surface p-3">
              <IdentityAvatar address={selectedAgent.address} size={40} alt={agentName} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-sans text-sm font-medium text-text-primary">
                  {agentName}
                </p>
                <p className="font-sans text-xs text-text-secondary">Selected agent</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedAgent(null);
                  setStep("agent");
                }}
                className="shrink-0 font-sans text-xs text-accent-warm underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
              >
                Change
              </button>
            </div>

            {/* TODO(product): when listingCurrencyCodesForChain returns >1 code, decide whether
                the owner specifies intended currency, the agent is constrained at listOnBehalf,
                or AgentAuth gains an on-chain currencyCode — do not re-add a selector that
                implies a guarantee the contract does not enforce at authorize time. */}
            <div className="space-y-2">
              <Label htmlFor="agent-min-price">
                Minimum you&apos;ll receive ({chainListingCurrency})
              </Label>
              <input
                id="agent-min-price"
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={minPriceInput}
                onChange={(e) => setMinPriceInput(e.target.value)}
                className="min-h-11 w-full rounded-sm border border-border-default bg-bg-card px-4 py-3 font-sans text-sm text-text-primary transition-colors duration-200 placeholder:text-text-tertiary focus:border-accent-warm focus:bg-bg-surface focus:outline-none focus-visible:shadow-[var(--focus-ring)]"
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <Checkbox
                  id="agent-no-expiry"
                  checked={noExpiration}
                  onCheckedChange={(v) => setNoExpiration(v === true)}
                />
                <Label htmlFor="agent-no-expiry" className="text-sm leading-snug text-text-primary">
                  No expiration
                </Label>
              </div>
              {!noExpiration && (
                <div className="space-y-2">
                  <Label htmlFor="agent-expiry-date">Authorization expires</Label>
                  <input
                    id="agent-expiry-date"
                    type="date"
                    min={dateInputMin()}
                    value={expiryDate}
                    onChange={(e) => setExpiryDate(e.target.value)}
                    className="min-h-11 w-full rounded-sm border border-border-default bg-bg-card px-4 py-3 font-sans text-sm text-text-primary transition-colors duration-200 focus:border-accent-warm focus:bg-bg-surface focus:outline-none focus-visible:shadow-[var(--focus-ring)]"
                  />
                  {expiryDate && !isFutureDate(expiryDate) && (
                    <p className="text-xs text-status-error">Choose a future date.</p>
                  )}
                </div>
              )}
            </div>

            {formattedMinPrice && (
              <p className="rounded-md border border-border-default bg-bg-surface p-4 text-sm text-text-secondary">
                {agentName} can list, price, and sell your vehicle on your behalf. When they list
                it, you&apos;re guaranteed to receive at least {formattedMinPrice} in the currency
                they choose — after their fee and platform fees.
              </p>
            )}

            {txError && (
              <p className="text-sm text-status-error" role="alert">
                {txError}
              </p>
            )}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={!canSubmitTerms || isPending}
                onClick={() => void runAuthorize()}
              >
                Authorize agent
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
