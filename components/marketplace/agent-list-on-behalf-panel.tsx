"use client";

import { useCallback, useMemo, useState } from "react";
import { parseUnits, toBytes } from "viem";
import { waitForTransactionReceipt } from "wagmi/actions";
import {
  useAccount,
  useChainId,
  useConfig,
  useSwitchChain,
  useWriteContract,
} from "wagmi";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  SellerNetCalculator,
  sellerNetSatisfied,
} from "@/components/marketplace/seller-net-calculator";
import { MarketplaceEscrowAbi } from "@/lib/contracts/abis.generated";
import {
  encodeCurrencyCode,
  listingCurrencyCodesForChain,
  type ListingCurrencyCode,
} from "@/lib/marketplace/currency-code";
import { MAX_AGENT_FEE_BPS } from "@/lib/marketplace/seller-net";
import { txErrorMessage } from "@/lib/marketplace/tx-error-message";
import { marketplaceAddress } from "@/lib/web3/deployment-addresses";
import { wagmiChainId } from "@/lib/web3/supported-chains";

type Props = {
  chainId: number;
  tokenId: string;
  ownerMinPrice1e8: bigint;
  platformFeeBps: bigint | null | undefined;
  wallet: `0x${string}`;
  onSuccess: () => void;
};

function parseCommissionBps(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const pct = Number(trimmed);
  if (!Number.isFinite(pct) || pct < 0 || pct > 30) return null;
  const bps = Math.round(pct * 100);
  if (bps > MAX_AGENT_FEE_BPS) return null;
  return bps;
}

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

export function AgentListOnBehalfPanel({
  chainId,
  tokenId,
  ownerMinPrice1e8,
  platformFeeBps,
  wallet,
  onSuccess,
}: Props) {
  const config = useConfig();
  const wc = wagmiChainId(chainId);
  const { address, isConnected } = useAccount();
  const walletChain = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync, isPending } = useWriteContract();

  const market = marketplaceAddress(chainId);
  const tid = BigInt(tokenId);
  const wrongChain = walletChain !== chainId;
  const listingCurrency: ListingCurrencyCode =
    listingCurrencyCodesForChain(chainId)[0] ?? "USD";

  const [priceInput, setPriceInput] = useState("");
  const [commissionInput, setCommissionInput] = useState("");
  const [settlementNote, setSettlementNote] = useState("");
  const [txError, setTxError] = useState<string | null>(null);

  const price1e8 = useMemo(() => parsePrice1e8(priceInput), [priceInput]);
  const agentFeeBps = useMemo(
    () => parseCommissionBps(commissionInput) ?? -1,
    [commissionInput],
  );
  const validCommission = agentFeeBps >= 0;

  const canSubmitNet = sellerNetSatisfied(
    price1e8,
    validCommission ? agentFeeBps : -1,
    platformFeeBps,
    ownerMinPrice1e8,
  );

  const isAgentWallet =
    isConnected && address?.toLowerCase() === wallet.toLowerCase();

  const submitDisabledReason = useMemo(() => {
    if (!isAgentWallet) return "Connect the agent wallet to list this vehicle.";
    if (!market) return "Marketplace not configured for this chain.";
    if (platformFeeBps == null) return "Loading platform fee…";
    if (price1e8 == null) return "Enter a valid asking price.";
    if (!validCommission) return "Enter a commission between 0% and 30%.";
    if (!canSubmitNet) {
      return "Owner minimum not met — raise the price or lower your commission.";
    }
    return null;
  }, [
    isAgentWallet,
    market,
    platformFeeBps,
    price1e8,
    validCommission,
    canSubmitNet,
  ]);

  const runListOnBehalf = useCallback(async () => {
    if (!market || !canSubmitNet || price1e8 == null || !validCommission) return;
    if (wrongChain) await switchChainAsync?.({ chainId: wc });
    setTxError(null);
    try {
      const noteBytes = settlementNote.trim()
        ? toBytes(settlementNote.trim())
        : ("0x" as const);
      const hash = await writeContractAsync({
        address: market,
        abi: MarketplaceEscrowAbi,
        functionName: "listOnBehalf",
        args: [
          tid,
          price1e8,
          encodeCurrencyCode(listingCurrency),
          agentFeeBps,
          noteBytes,
        ],
      });
      await waitForTransactionReceipt(config, { hash });
      onSuccess();
    } catch (err) {
      setTxError(txErrorMessage(err));
    }
  }, [
    market,
    canSubmitNet,
    price1e8,
    validCommission,
    wrongChain,
    switchChainAsync,
    wc,
    settlementNote,
    writeContractAsync,
    tid,
    listingCurrency,
    agentFeeBps,
    config,
    onSuccess,
  ]);

  return (
    <div className="mt-3 space-y-3 border-t border-border-default pt-3">
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
          disabled={isPending}
          className="border-border-default bg-bg-card"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={`list-commission-${tokenId}`}>Your commission (%)</Label>
        <Input
          id={`list-commission-${tokenId}`}
          inputMode="decimal"
          placeholder="5"
          value={commissionInput}
          onChange={(e) => setCommissionInput(e.target.value)}
          disabled={isPending}
          className="border-border-default bg-bg-card"
        />
        {commissionInput.trim() && !validCommission && (
          <p className="text-xs text-status-error">Commission must be between 0% and 30%.</p>
        )}
      </div>

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
          disabled={isPending}
          className="border-border-default bg-bg-card"
        />
      </div>

      <SellerNetCalculator
        price1e8={price1e8}
        agentFeeBps={validCommission ? agentFeeBps : 0}
        platformFeeBps={platformFeeBps}
        ownerMinPrice1e8={ownerMinPrice1e8}
        currencyCode={listingCurrency}
      />

      {txError && (
        <p className="text-sm text-status-error" role="alert">
          {txError}
        </p>
      )}

      {submitDisabledReason && !isPending && (
        <p className="text-xs text-text-secondary">{submitDisabledReason}</p>
      )}

      <Button
        type="button"
        className="w-full"
        disabled={isPending || Boolean(submitDisabledReason)}
        onClick={() => void runListOnBehalf()}
      >
        List for sale
      </Button>
    </div>
  );
}
