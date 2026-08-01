"use client";

import { useCallback, useMemo, useState } from "react";
import { parseUnits, stringToHex } from "viem";
import {
  useAccount,
  useChainId,
  useSwitchChain,
  useWriteContract,
} from "wagmi";

import { Button } from "@/components/ui/button";
import { CommercePausedNotice } from "@/components/commerce/commerce-paused-notice";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { TX_SYNC_LAG_ADVISORY, useTxSync } from "@/hooks/use-tx-sync";
import { useCommerceModePaused } from "@/hooks/use-commerce-mode-paused";
import {
  SellerNetCalculator,
  agentedPriceMeetsFloor,
} from "@/components/marketplace/seller-net-calculator";
import { COMPENSATION_FORM } from "@/lib/commerce/denomination";
import type { MandateSnapshot } from "@/lib/commerce/mandate";
import { commerceModeAddress } from "@/lib/commerce/mode";
import { FixedPriceConsignmentAbi } from "@/lib/contracts/abis.generated";
import type { ListingCurrencyCode } from "@/lib/marketplace/currency-code";
import { SETTLEMENT_NOTE_WRITE_DISCLOSURE } from "@/lib/marketplace/settlement-note";
import { txErrorMessage } from "@/lib/marketplace/tx-error-message";
import { wagmiChainId } from "@/lib/web3/supported-chains";

type Props = {
  chainId: number;
  tokenId: string;
  /** Mandate snapshot — floor, denomination and compensation are fixed by it. */
  mandate: MandateSnapshot;
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
 * Agent opens a fixed-price consignment from the owner's mandate. Asset,
 * denomination, floor and compensation come from the mandate snapshot; the
 * agent only chooses the asking price.
 */
export function AgentListOnBehalfPanel({
  chainId,
  tokenId,
  mandate,
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
  const { paused: modePaused } = useCommerceModePaused({
    mode: "fixedPrice",
    chainId,
  });
  const listingCurrency: ListingCurrencyCode = "USD";

  const [priceInput, setPriceInput] = useState("");
  const [settlementNote, setSettlementNote] = useState("");
  const [txError, setTxError] = useState<string | null>(null);

  const price1e8 = useMemo(() => parsePrice1e8(priceInput), [priceInput]);

  const meetsFloor = agentedPriceMeetsFloor({
    price: price1e8,
    floor: mandate.floor,
    compensationForm: mandate.compensationForm,
    commissionBps: mandate.commissionBps,
    platformFeeBps,
  });

  const isAgentWallet =
    isConnected && address?.toLowerCase() === wallet.toLowerCase();

  const submitDisabledReason = useMemo(() => {
    if (modePaused === true) return null;
    if (!isAgentWallet) return "Connect the agent wallet to list this vehicle.";
    if (!market) return "Fixed price sales are not available on this chain.";
    if (platformFeeBps == null) return "Loading platform fee…";
    if (price1e8 == null) return "Enter a valid asking price.";
    if (!meetsFloor) return "Mandate floor not met — raise the price.";
    return null;
  }, [modePaused, isAgentWallet, market, platformFeeBps, price1e8, meetsFloor]);

  const runListOnBehalf = useCallback(async () => {
    if (!market || !meetsFloor || price1e8 == null) return;
    if (wrongChain) await switchChainAsync?.({ chainId: wc });
    setTxError(null);
    try {
      const succeeded = await runTx(() =>
        writeContractAsync({
          address: market,
          abi: FixedPriceConsignmentAbi,
          functionName: "openFromMandate",
          args: [
            tid,
            {
              kind: mandate.denominationKind,
              currencyCode: mandate.currencyCode,
            },
            price1e8,
          ],
        }),
      );
      if (!succeeded) return;
      const note = settlementNote.trim();
      if (note) {
        await runTx(() =>
          writeContractAsync({
            address: market,
            abi: FixedPriceConsignmentAbi,
            functionName: "setSettlementNote",
            args: [tid, stringToHex(note)],
          }),
        );
      }
      onSuccess();
    } catch (err) {
      setTxError(txErrorMessage(err));
    }
  }, [
    market,
    meetsFloor,
    price1e8,
    wrongChain,
    switchChainAsync,
    wc,
    mandate.denominationKind,
    mandate.currencyCode,
    settlementNote,
    writeContractAsync,
    tid,
    onSuccess,
    runTx,
  ]);

  return (
    <div className="mt-3 space-y-3 border-t border-border-default pt-3">
      {modePaused === true ? <CommercePausedNotice mode="fixedPrice" /> : null}

      <div className="space-y-2">
        <Label htmlFor={`list-price-${tokenId}`}>
          Asking price ({listingCurrency})
        </Label>
        <Input
          id={`list-price-${tokenId}`}
          inputMode="decimal"
          placeholder="42,000"
          value={priceInput}
          onChange={(e) => setPriceInput(e.target.value)}
          disabled={busy || modePaused === true}
          className="border-border-default bg-bg-card"
        />
      </div>

      <p className="font-sans text-xs text-text-secondary">
        {mandate.compensationForm === COMPENSATION_FORM.Margin
          ? "You keep everything above the owner's floor, after the platform fee."
          : `Your commission is fixed by the mandate at ${(mandate.commissionBps / 100).toFixed(2)}%.`}
      </p>

      <div className="space-y-2">
        <Label htmlFor={`list-settlement-${tokenId}`}>
          Direct payment instructions (optional)
        </Label>
        <Textarea
          id={`list-settlement-${tokenId}`}
          value={settlementNote}
          onChange={(e) => setSettlementNote(e.target.value)}
          placeholder="e.g. Bank IBAN, BTC address, or payment instructions for the buyer"
          rows={2}
          disabled={busy}
          className="border-border-default bg-bg-card"
        />
        <p className="font-sans text-xs text-text-secondary">
          {SETTLEMENT_NOTE_WRITE_DISCLOSURE}
        </p>
      </div>

      <SellerNetCalculator
        price1e8={price1e8}
        floor1e8={mandate.floor}
        compensationForm={mandate.compensationForm}
        commissionBps={mandate.commissionBps}
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
        disabled={busy || modePaused === true || Boolean(submitDisabledReason)}
        onClick={() => void runListOnBehalf()}
      >
        {busy ? "Confirming…" : "List for sale"}
      </Button>
    </div>
  );
}
