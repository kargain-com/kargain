"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { parseUnits } from "viem";
import {
  useAccount,
  useChainId,
  useReadContract,
  useSwitchChain,
  useWriteContract,
} from "wagmi";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ListingSellerSettlementPanel } from "@/components/marketplace/listing-seller-settlement-panel";
import { TX_SYNC_LAG_ADVISORY, useTxSync } from "@/hooks/use-tx-sync";
import {
  SellerNetCalculator,
  agentedPriceMeetsFloor,
} from "@/components/marketplace/seller-net-calculator";
import {
  COMPENSATION_FORM,
  type CompensationForm,
} from "@/lib/commerce/denomination";
import { commerceModeAddress } from "@/lib/commerce/mode";
import { FixedPriceConsignmentAbi } from "@/lib/contracts/abis.generated";
import {
  listingCurrencyCodesForChain,
  type ListingCurrencyCode,
} from "@/lib/marketplace/currency-code";
import { formatFiat1e8 } from "@/lib/marketplace/fiat-format";
import { decodeSettlementNote } from "@/lib/marketplace/settlement-note";
import { txErrorMessage } from "@/lib/marketplace/tx-error-message";
import { wagmiChainId } from "@/lib/web3/supported-chains";

type Props = {
  chainId: number;
  tokenId: string;
  /** Snapshotted consignment terms — floor and compensation are immutable-down. */
  price1e8: bigint;
  floor1e8: bigint;
  compensationForm: CompensationForm;
  commissionBps: number;
  platformFeeBps: bigint | null | undefined;
  wallet: `0x${string}`;
  onSuccess: () => void;
};

function parsePrice1e8(input: string): bigint | null {
  if (!input.trim()) return null;
  try {
    const amount = parseUnits(input, 8);
    if (amount <= 0n) return null;
    return amount;
  } catch {
    return null;
  }
}

function parseCommissionBps(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const pct = Number(trimmed);
  if (!Number.isFinite(pct) || pct < 0) return null;
  return Math.round(pct * 100);
}

/**
 * Runner amends a live fixed-price consignment: price freely (subject to the
 * mandate floor) and commission downward only (`lowerCommission`).
 */
export function AgentUpdateListingPanel({
  chainId,
  tokenId,
  price1e8: currentPrice1e8,
  floor1e8,
  compensationForm,
  commissionBps,
  platformFeeBps,
  wallet,
  onSuccess,
}: Props) {
  const wc = wagmiChainId(chainId);
  const { address, isConnected } = useAccount();
  const walletChain = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync, isPending } = useWriteContract();
  const { runTx, phase, error, syncLagged } = useTxSync(chainId);
  const busy = isPending || phase !== "idle";

  const market = commerceModeAddress("fixedPrice", chainId);
  const tid = BigInt(tokenId);
  const wrongChain = walletChain !== chainId;
  const listingCurrency: ListingCurrencyCode =
    listingCurrencyCodesForChain(chainId)[0] ?? "USD";

  const [priceInput, setPriceInput] = useState(() =>
    formatFiat1e8(currentPrice1e8),
  );
  const [commissionInput, setCommissionInput] = useState("");
  const [settlementNote, setSettlementNote] = useState("");
  const [txError, setTxError] = useState<string | null>(null);

  const { data: settlementNoteRaw } = useReadContract({
    address: market,
    abi: FixedPriceConsignmentAbi,
    functionName: "settlementNotes",
    args: [tid],
    chainId: wc,
    query: { enabled: Boolean(market) },
  });

  const onChainNote = decodeSettlementNote(settlementNoteRaw).trim();

  useEffect(() => {
    if (onChainNote) setSettlementNote(onChainNote);
  }, [onChainNote]);

  const price1e8 = useMemo(() => parsePrice1e8(priceInput), [priceInput]);
  const nextCommissionBps = useMemo(
    () => parseCommissionBps(commissionInput),
    [commissionInput],
  );
  const commissionLowered =
    nextCommissionBps != null && nextCommissionBps < commissionBps;
  const commissionInvalid =
    commissionInput.trim().length > 0 && !commissionLowered;

  const effectiveCommissionBps = commissionLowered
    ? nextCommissionBps
    : commissionBps;

  const meetsFloor = agentedPriceMeetsFloor({
    price: price1e8,
    floor: floor1e8,
    compensationForm,
    commissionBps: effectiveCommissionBps,
    platformFeeBps,
  });

  const isAgentWallet =
    isConnected && address?.toLowerCase() === wallet.toLowerCase();

  const submitDisabledReason = useMemo(() => {
    if (!isAgentWallet) return "Connect the agent wallet to update this sale.";
    if (!market) return "Fixed price sales are not available on this chain.";
    if (platformFeeBps == null) return "Loading platform fee…";
    if (price1e8 == null) return "Enter a valid asking price.";
    if (commissionInvalid) {
      return "Commission can only be lowered.";
    }
    if (!meetsFloor) return "Mandate floor not met — raise the price.";
    return null;
  }, [
    isAgentWallet,
    market,
    platformFeeBps,
    price1e8,
    commissionInvalid,
    meetsFloor,
  ]);

  const runUpdateListing = useCallback(async () => {
    if (!market || !meetsFloor || price1e8 == null) return;
    if (wrongChain) await switchChainAsync?.({ chainId: wc });
    setTxError(null);
    try {
      if (commissionLowered && nextCommissionBps != null) {
        const loweredOk = await runTx(() =>
          writeContractAsync({
            address: market,
            abi: FixedPriceConsignmentAbi,
            functionName: "lowerCommission",
            args: [tid, nextCommissionBps],
          }),
        );
        if (!loweredOk) return;
      }
      if (price1e8 !== currentPrice1e8) {
        const pricedOk = await runTx(() =>
          writeContractAsync({
            address: market,
            abi: FixedPriceConsignmentAbi,
            functionName: "setPrice",
            args: [tid, price1e8],
          }),
        );
        if (!pricedOk) return;
      }
      onSuccess();
    } catch (err) {
      setTxError(txErrorMessage(err));
    }
  }, [
    market,
    meetsFloor,
    price1e8,
    currentPrice1e8,
    commissionLowered,
    nextCommissionBps,
    wrongChain,
    switchChainAsync,
    wc,
    writeContractAsync,
    tid,
    onSuccess,
    runTx,
  ]);

  return (
    <div className="mt-3 space-y-3 border-t border-border-default pt-3">
      <div className="space-y-2">
        <Label htmlFor={`update-price-${tokenId}`}>
          Asking price ({listingCurrency})
        </Label>
        <Input
          id={`update-price-${tokenId}`}
          inputMode="decimal"
          placeholder="42,000"
          value={priceInput}
          onChange={(e) => setPriceInput(e.target.value)}
          disabled={busy}
          className="border-border-default bg-bg-card"
        />
      </div>

      {compensationForm === COMPENSATION_FORM.Commission && (
        <div className="space-y-2">
          <Label htmlFor={`update-commission-${tokenId}`}>
            Lower your commission (%)
          </Label>
          <Input
            id={`update-commission-${tokenId}`}
            inputMode="decimal"
            placeholder={(commissionBps / 100).toFixed(2)}
            value={commissionInput}
            onChange={(e) => setCommissionInput(e.target.value)}
            disabled={busy}
            className="border-border-default bg-bg-card"
          />
          {commissionInvalid && (
            <p className="text-xs text-status-error">
              Enter a value below {(commissionBps / 100).toFixed(2)}%.
              Commission can only be lowered.
            </p>
          )}
        </div>
      )}

      <SellerNetCalculator
        price1e8={price1e8}
        floor1e8={floor1e8}
        compensationForm={compensationForm}
        commissionBps={effectiveCommissionBps}
        platformFeeBps={platformFeeBps}
        currencyCode={listingCurrency}
      />

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

      {submitDisabledReason && !busy && (
        <p className="text-xs text-text-secondary">{submitDisabledReason}</p>
      )}

      <Button
        type="button"
        className="w-full"
        disabled={busy || Boolean(submitDisabledReason)}
        onClick={() => void runUpdateListing()}
      >
        {busy ? "Confirming…" : "Update sale"}
      </Button>

      <div className="space-y-2 border-t border-border-default pt-3">
        <h3 className="text-sm font-medium text-text-primary">
          Direct payment instructions
        </h3>
        <p className="text-xs text-text-secondary">
          Shown to buyers who want to pay outside Kargain checkout.
        </p>
        <ListingSellerSettlementPanel
          chainId={chainId}
          priceInput=""
          onPriceInputChange={() => {}}
          askingCurrency={listingCurrency}
          onAskingCurrencyChange={() => {}}
          settlementNote={settlementNote}
          onSettlementNoteChange={() => {}}
          priceInputId={`agent-settlement-${tokenId}`}
          showAskingFields={false}
          disabled
        />
      </div>
    </div>
  );
}
