"use client";

import { useActiveAccount, requireEvmSession, evmSwitchChainAvailability } from "@/hooks/use-active-account";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { useWriteContract } from "wagmi";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { VerifierDirectory } from "@/components/verifier/verifier-directory";
import { useOpenableTerms } from "@/hooks/use-openable-terms";
import { TX_SYNC_LAG_ADVISORY, useTxSync } from "@/hooks/use-tx-sync";
import { usePassportApproval } from "@/hooks/use-passport-approval";
import { sansLink } from "@/lib/design/instrument-classes";
import {
  buildCompensation,
  compensationFormDef,
  EXTERNAL_PAYMENT_GRANT_DISCLOSURE,
} from "@/lib/commerce/compensation-form";
import {
  COMPENSATION_FORM,
  DENOMINATION_KIND,
  encodeCurrencyCode,
  FIAT_PRICE_DECIMALS,
  ZERO_CURRENCY_CODE,
  type CompensationForm,
  type DenominationKind,
} from "@/lib/commerce/denomination";
import { commerceModeAddress } from "@/lib/commerce/mode";
import { ZERO_ADDRESS } from "@/lib/commerce/consignment";
import { gateOpenablePairing } from "@/lib/commerce/openable-terms";
import { FixedPriceConsignmentAbi } from "@/lib/contracts/abis.generated";
import { txErrorMessage } from "@/lib/marketplace/tx-error-message";
import { navShortAddress } from "@/lib/web3/wallet-display";
import { cn } from "@/lib/utils";
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

export function AuthorizeAgentDialog({
  chainId,
  tokenId,
  open,
  onOpenChange,
  onAuthorized,
}: Props) {
  const { account, switchChain } = useActiveAccount();
  const evm = requireEvmSession(account);
  const address = evm.ok ? evm.address : undefined;
  const walletChain = evm.ok ? evm.chainId : undefined;
  const switchAvail = evmSwitchChainAvailability(account);

  const wc = wagmiChainId(chainId);
        const { writeContractAsync, isPending } = useWriteContract();
  const { runTx, awaitReceipt, phase, error, syncLagged } = useTxSync(chainId);
  const busy = isPending || phase !== "idle";

  const market = commerceModeAddress("fixedPrice", chainId);
  const tid = BigInt(tokenId);
  const wrongChain = walletChain !== chainId;

  const { options: openOptions, pending: openOptionsPending } =
    useOpenableTerms(chainId, "fixedPrice");

  const [step, setStep] = useState<Step>("approval");
  const [txError, setTxError] = useState<string | null>(null);
  const [verifiers, setVerifiers] = useState<VerifierDirectoryEntry[]>([]);
  const [verifiersLoading, setVerifiersLoading] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<VerifierDirectoryEntry | null>(null);
  const [settlementAsset, setSettlementAsset] = useState<string>(ZERO_ADDRESS);
  const [denominationKind, setDenominationKind] = useState<DenominationKind>(
    DENOMINATION_KIND.Fiat,
  );
  const [fiatCurrency, setFiatCurrency] = useState("USD");
  const [compensationForm, setCompensationForm] = useState<CompensationForm>(
    COMPENSATION_FORM.Margin,
  );
  const [commissionPercent, setCommissionPercent] = useState("");
  const [minPriceInput, setMinPriceInput] = useState("");
  const [noExpiration, setNoExpiration] = useState(true);
  const [expiryDate, setExpiryDate] = useState("");

  const {
    isApproved: isMarketplaceApproved,
    approveForAll,
    approveToken,
  } = usePassportApproval({
    chainId,
    tokenId,
    spender: market,
    enabled: open && Boolean(market && address),
  });

  const displayStep: Step =
    step === "approval" && isMarketplaceApproved ? "agent" : step;

  const selectedAsset = useMemo(
    () =>
      openOptions.assets.find(
        (a) => a.token.toLowerCase() === settlementAsset.toLowerCase(),
      ),
    [openOptions.assets, settlementAsset],
  );

  const floorDecimals =
    denominationKind === DENOMINATION_KIND.Asset
      ? (selectedAsset?.decimals ?? 18)
      : FIAT_PRICE_DECIMALS;

  const floorUnitLabel =
    denominationKind === DENOMINATION_KIND.Asset
      ? (selectedAsset?.label ?? "asset")
      : fiatCurrency;

  useEffect(() => {
    if (!openOptions.available || openOptions.assets.length === 0) return;
    const stillValid = openOptions.assets.some(
      (a) => a.token.toLowerCase() === settlementAsset.toLowerCase(),
    );
    if (!stillValid) {
      setSettlementAsset(openOptions.assets[0]!.token);
    }
  }, [openOptions, settlementAsset]);

  useEffect(() => {
    if (!selectedAsset) return;
    if (
      denominationKind === DENOMINATION_KIND.Fiat &&
      !selectedAsset.fiatDenomination
    ) {
      setDenominationKind(DENOMINATION_KIND.Asset);
    }
  }, [selectedAsset, denominationKind]);

  useEffect(() => {
    if (openOptions.fiatCurrencyCodes.length === 0) return;
    if (!openOptions.fiatCurrencyCodes.includes(fiatCurrency)) {
      setFiatCurrency(openOptions.fiatCurrencyCodes[0]!);
    }
  }, [openOptions.fiatCurrencyCodes, fiatCurrency]);

  const resetState = useCallback(() => {
    setStep("approval");
    setTxError(null);
    setSelectedAgent(null);
    setSettlementAsset(ZERO_ADDRESS);
    setDenominationKind(DENOMINATION_KIND.Fiat);
    setFiatCurrency("USD");
    setCompensationForm(COMPENSATION_FORM.Margin);
    setCommissionPercent("");
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
    if (!market) return;
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
  }, [market, wrongChain, switchChain, wc, approveForAll, awaitReceipt, switchAvail]);

  const runApproveToken = useCallback(async () => {
    if (!market) return;
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
  }, [market, wrongChain, switchChain, wc, approveToken, awaitReceipt, switchAvail]);

  const handleSelectAgent = useCallback((entry: VerifierDirectoryEntry) => {
    setSelectedAgent(entry);
    setStep("terms");
    setTxError(null);
  }, []);

  const pairingGate = useMemo(
    () =>
      gateOpenablePairing(openOptions, {
        asset: settlementAsset,
        denominationKind,
        currencyCode:
          denominationKind === DENOMINATION_KIND.Fiat ? fiatCurrency : undefined,
      }),
    [openOptions, settlementAsset, denominationKind, fiatCurrency],
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
    if (!minPriceInput.trim()) return null;
    try {
      const amount = parseUnits(minPriceInput, floorDecimals);
      return amount > 0n ? amount : null;
    } catch {
      return null;
    }
  }, [minPriceInput, floorDecimals]);

  const canSubmitTerms = useMemo(() => {
    if (!selectedAgent || !market) return false;
    if (!openOptions.available || openOptionsPending) return false;
    if (!pairingGate.available) return false;
    if (floorParsed == null) return false;
    if ("ok" in compensationBuilt && compensationBuilt.ok === false) return false;
    if (noExpiration) return true;
    return expiryDate !== "" && isFutureDate(expiryDate);
  }, [
    selectedAgent,
    market,
    openOptions.available,
    openOptionsPending,
    pairingGate,
    floorParsed,
    compensationBuilt,
    noExpiration,
    expiryDate,
  ]);

  const runAuthorize = useCallback(async () => {
    if (!market || !selectedAgent || !canSubmitTerms || floorParsed == null)
      return;
    if ("ok" in compensationBuilt && compensationBuilt.ok === false) {
      setTxError(compensationBuilt.reason);
      return;
    }
    if (!pairingGate.available) {
      setTxError(pairingGate.cause);
      return;
    }
    if (wrongChain) {
        if (!switchAvail.available) throw new Error(`switchChain unavailable: ${switchAvail.cause}`);
        await switchChain(wc );
      }
    setTxError(null);
    try {
      const expiry = noExpiration ? 0n : dateToExpiryUnix(expiryDate);
      const compensation =
        "form" in compensationBuilt
          ? compensationBuilt
          : { form: COMPENSATION_FORM.Margin, commissionBps: 0 };
      const succeeded = await runTx(() =>
        writeContractAsync({
          address: market,
          abi: FixedPriceConsignmentAbi,
          functionName: "grant",
          args: [
            tid,
            selectedAgent.address as `0x${string}`,
            expiry,
            settlementAsset as `0x${string}`,
            {
              kind: denominationKind,
              currencyCode:
                denominationKind === DENOMINATION_KIND.Fiat
                  ? encodeCurrencyCode(fiatCurrency)
                  : ZERO_CURRENCY_CODE,
            },
            floorParsed,
            compensation,
          ],
        }),
      );
      if (!succeeded) return;
      onAuthorized();
      handleOpenChange(false);
    } catch (err) {
      setTxError(txErrorMessage(err));
    }
  }, [
    market,
    selectedAgent,
    canSubmitTerms,
    floorParsed,
    compensationBuilt,
    pairingGate,
    wrongChain,
    switchChain,
    wc,
    noExpiration,
    expiryDate,
    settlementAsset,
    denominationKind,
    fiatCurrency,
    writeContractAsync,
    tid,
    onAuthorized,
    handleOpenChange,
    runTx, switchAvail]);

  const agentName = selectedAgent ? agentDisplayName(selectedAgent) : "";
  const formattedFloor =
    floorParsed != null
      ? `${formatUnits(floorParsed, floorDecimals)} ${floorUnitLabel}`
      : null;
  const compensationConsequence = compensationFormDef(compensationForm).consequence;
  const fiatAllowed = selectedAsset?.fiatDenomination === true;
  const fiatReason = selectedAsset?.fiatUnavailableReason;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent showClose className="max-w-lg max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Delegate to a pro</DialogTitle>
          <DialogDescription>
            Authorize a KarPro to list and sell your vehicle on your behalf. You
            choose the settlement terms and compensation before they can open a
            sale.
          </DialogDescription>
        </DialogHeader>

        {displayStep === "approval" && !isMarketplaceApproved && (
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">
              Before delegating, approve the fixed-price consignment contract to hold your passport when your
              agent lists it for sale. This avoids surprises when they try to list on your behalf.
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
                {busy ? "Confirming…" : "Approve fixed-price mode for all passports"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void runApproveToken()}
              >
                {busy ? "Confirming…" : "Approve this passport only"}
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
                    <div className="h-9 w-28 shrink-0 rounded bg-bg-surface" />
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
                className={cn(sansLink, "shrink-0 text-xs underline-offset-2 hover:underline")}
              >
                Change
              </button>
            </div>

            {!openOptions.available && !openOptionsPending ? (
              <p className="font-sans text-sm text-text-secondary" role="status">
                {openOptions.unavailableReason}
              </p>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="grant-settlement-asset">Settlement asset</Label>
                  <Select
                    value={settlementAsset}
                    onValueChange={setSettlementAsset}
                    disabled={busy || openOptionsPending || openOptions.assets.length === 0}
                  >
                    <SelectTrigger
                      id="grant-settlement-asset"
                      className="border-border-default bg-bg-card"
                    >
                      <SelectValue
                        placeholder={
                          openOptionsPending ? "Loading…" : "Select asset"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent className="border-border-default bg-bg-primary">
                      {openOptions.assets.map((asset) => (
                        <SelectItem key={asset.token} value={asset.token}>
                          {asset.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="grant-denomination">Price denomination</Label>
                  <Select
                    value={String(denominationKind)}
                    onValueChange={(v) =>
                      setDenominationKind(
                        Number(v) === DENOMINATION_KIND.Asset
                          ? DENOMINATION_KIND.Asset
                          : DENOMINATION_KIND.Fiat,
                      )
                    }
                    disabled={busy || openOptionsPending || !selectedAsset}
                  >
                    <SelectTrigger
                      id="grant-denomination"
                      className="border-border-default bg-bg-card"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-border-default bg-bg-primary">
                      <SelectItem value={String(DENOMINATION_KIND.Asset)}>
                        Asset units
                      </SelectItem>
                      <SelectItem
                        value={String(DENOMINATION_KIND.Fiat)}
                        disabled={!fiatAllowed}
                      >
                        Fiat
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  {!fiatAllowed && fiatReason ? (
                    <p className="font-sans text-xs text-text-secondary" role="status">
                      {fiatReason}
                    </p>
                  ) : null}
                </div>

                {denominationKind === DENOMINATION_KIND.Fiat && fiatAllowed ? (
                  <div className="space-y-2">
                    <Label htmlFor="grant-fiat-currency">Currency</Label>
                    <Select
                      value={fiatCurrency}
                      onValueChange={setFiatCurrency}
                      disabled={busy || openOptionsPending}
                    >
                      <SelectTrigger
                        id="grant-fiat-currency"
                        className="border-border-default bg-bg-card"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="border-border-default bg-bg-primary">
                        {openOptions.fiatCurrencyCodes.map((code) => (
                          <SelectItem key={code} value={code}>
                            {code}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
              </>
            )}

            <div className="space-y-2">
              <Label htmlFor="agent-min-price">
                Minimum you&apos;ll receive ({floorUnitLabel})
              </Label>
              <input
                id="agent-min-price"
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={minPriceInput}
                onChange={(e) => setMinPriceInput(e.target.value)}
                disabled={!openOptions.available}
                className="min-h-11 w-full rounded-sm border border-border-default bg-bg-card px-4 py-3 font-sans text-sm text-text-primary transition-colors duration-200 placeholder:text-text-tertiary focus:border-accent-warm focus:bg-bg-surface focus:outline-none focus-visible:shadow-[var(--focus-ring)]"
              />
            </div>

            <MandateCompensationFields
              form={compensationForm}
              onFormChange={setCompensationForm}
              commissionPercent={commissionPercent}
              onCommissionPercentChange={setCommissionPercent}
              disabled={busy || !openOptions.available}
            />

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

            {formattedFloor && (
              <p className="rounded-md border border-border-default bg-bg-surface p-4 text-sm text-text-secondary">
                {agentName} can list, price, and sell your vehicle on your behalf.
                Your floor is{" "}
                <span className="font-mono tabular-nums text-text-primary">
                  {formattedFloor}
                </span>
                . {compensationConsequence}
              </p>
            )}

            <p className="font-sans text-sm text-text-secondary">
              {EXTERNAL_PAYMENT_GRANT_DISCLOSURE}
            </p>

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
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={!canSubmitTerms || busy}
                onClick={() => void runAuthorize()}
              >
                {busy ? "Confirming…" : "Authorize agent"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
