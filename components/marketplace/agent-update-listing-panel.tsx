"use client";

import { useActiveAccount, requireEvmSession, evmSwitchChainAvailability } from "@/hooks/use-active-account";

import { useCallback, useEffect, useMemo, useState } from "react";
import { parseUnits } from "viem";
import { useReadContract } from "wagmi";

import { AgentLowerCommissionPanel } from "@/components/commerce/agent-lower-commission-panel";
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
  DENOMINATION_KIND,
  type CompensationForm,
} from "@/lib/commerce/denomination";
import { ZERO_ADDRESS } from "@/lib/commerce/consignment";
import { deriveOpenableTerms } from "@/lib/commerce/openable-terms";
import { commerceModeAddress } from "@/lib/commerce/mode";
import { FixedPriceConsignmentAbi } from "@/lib/contracts/abis.generated";
import { formatFiat1e8 } from "@/lib/marketplace/fiat-format";
import type { ListingCurrencyCode } from "@/lib/marketplace/currency-code";
import { decodeSettlementNote } from "@/lib/marketplace/settlement-note";
import { txErrorMessage } from "@/lib/marketplace/tx-error-message";
import {
  commercialActive,
  nativeUnitOf,
} from "@/lib/web3/commercial-active";
import { wagmiChainId } from "@/lib/web3/supported-chains";
import { useEvmWriteContract } from "@/lib/web3/evm-write-adapter";

/** Native-only stub so the settlement-note chrome can render without open pairings. */
function settlementNoteOnlyOptions(chainId: number) {
  const unit = nativeUnitOf(commercialActive(chainId)!);
  return deriveOpenableTerms({
    mode: "fixedPrice",
    modeAvailable: true,
    configResolved: true,
    native: { label: unit.symbol, decimals: unit.decimals },
    paymentTokens: [],
    currencyFeeds: [],
  });
}

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

/**
 * Runner amends a live fixed-price consignment price (`setPrice`).
 * Commission concessions use the shared {@link AgentLowerCommissionPanel}.
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
  const { account, switchChain } = useActiveAccount();
  const evm = requireEvmSession(account);
  const address = evm.ok ? evm.address : undefined;
  const isConnected = evm.ok;
  const walletChain = evm.ok ? evm.chainId : undefined;
  const switchAvail = evmSwitchChainAvailability(account);

  const wc = wagmiChainId(chainId);
        const { writeContractAsync, isPending } = useEvmWriteContract();
  const { runTx, phase, error, syncLagged } = useTxSync(chainId);
  const busy = isPending || phase !== "idle";

  const market = commerceModeAddress("fixedPrice", chainId);
  const tid = BigInt(tokenId);
  const wrongChain = walletChain !== chainId;
  const listingCurrency: ListingCurrencyCode = "USD";

  const [priceInput, setPriceInput] = useState(() =>
    formatFiat1e8(currentPrice1e8),
  );
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

  const meetsFloor = agentedPriceMeetsFloor({
    price: price1e8,
    floor: floor1e8,
    compensationForm,
    commissionBps,
    platformFeeBps,
  });

  const isAgentWallet =
    isConnected && address?.toLowerCase() === wallet.toLowerCase();

  const submitDisabledReason = useMemo(() => {
    if (!isAgentWallet) return "Connect the agent wallet to update this sale.";
    if (!market) return "Fixed price sales are not available on this chain.";
    if (platformFeeBps == null) return "Loading platform fee…";
    if (price1e8 == null) return "Enter a valid asking price.";
    if (price1e8 === currentPrice1e8) return "Enter a new asking price.";
    if (!meetsFloor) return "Mandate floor not met — raise the price.";
    return null;
  }, [
    isAgentWallet,
    market,
    platformFeeBps,
    price1e8,
    currentPrice1e8,
    meetsFloor,
  ]);

  const runUpdateListing = useCallback(async () => {
    if (!market || !meetsFloor || price1e8 == null) return;
    if (wrongChain) {
        if (!switchAvail.available) throw new Error(`switchChain unavailable: ${switchAvail.cause}`);
        await switchChain(wc );
      }
    setTxError(null);
    try {
      const pricedOk = await runTx(() =>
        writeContractAsync({
          address: market,
          abi: FixedPriceConsignmentAbi,
          functionName: "setPrice",
          args: [tid, price1e8],
        }),
      );
      if (!pricedOk) return;
      onSuccess();
    } catch (err) {
      setTxError(txErrorMessage(err));
    }
  }, [
    market,
    meetsFloor,
    price1e8,
    wrongChain,
    switchChain,
    wc,
    writeContractAsync,
    tid,
    onSuccess,
    runTx, switchAvail]);

  return (
    <div className="mt-3 space-y-3 border-t border-border-default pt-3">
      <AgentLowerCommissionPanel
        mode="fixedPrice"
        chainId={chainId}
        tokenId={tokenId}
        live={true}
        isConsignmentAgent={isAgentWallet}
        compensationForm={compensationForm}
        snapshotCommissionBps={commissionBps}
        onChanged={onSuccess}
        embedded
      />

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

      <SellerNetCalculator
        price1e8={price1e8}
        floor1e8={floor1e8}
        compensationForm={compensationForm}
        commissionBps={commissionBps}
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
          openOptions={settlementNoteOnlyOptions(chainId)}
          settlementAsset={ZERO_ADDRESS}
          onSettlementAssetChange={() => {}}
          denominationKind={DENOMINATION_KIND.Fiat}
          onDenominationKindChange={() => {}}
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
