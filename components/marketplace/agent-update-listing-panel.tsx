"use client";

import { useCallback, useMemo, useState } from "react";
import { parseUnits } from "viem";
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
import { Input } from "@/components/ui/input";
import {
  SellerNetCalculator,
  sellerNetSatisfied,
} from "@/components/marketplace/seller-net-calculator";
import { MarketplaceEscrowAbi } from "@/lib/contracts/abis.generated";
import {
  listingCurrencyCodesForChain,
  type ListingCurrencyCode,
} from "@/lib/marketplace/currency-code";
import { formatFiat1e8 } from "@/lib/marketplace/fiat-format";
import { MAX_AGENT_FEE_BPS } from "@/lib/marketplace/seller-net";
import { txErrorMessage } from "@/lib/marketplace/tx-error-message";
import type { PonderAgentListingRaw } from "@/lib/types/ponder";
import { marketplaceAddress } from "@/lib/web3/deployment-addresses";
import { wagmiChainId } from "@/lib/web3/supported-chains";

type Props = {
  chainId: number;
  listing: PonderAgentListingRaw;
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

function initialCommissionPct(agentFeeBps: number | undefined): string {
  if (agentFeeBps == null || agentFeeBps <= 0) return "";
  return String(agentFeeBps / 100);
}

function initialPriceInput(fiatPrice1e8: string | number | undefined): string {
  if (fiatPrice1e8 == null) return "";
  try {
    return formatFiat1e8(BigInt(fiatPrice1e8));
  } catch {
    return "";
  }
}

export function AgentUpdateListingPanel({
  chainId,
  listing,
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
  const tokenId = String(listing.tokenId ?? listing.id ?? "");
  const tid = BigInt(tokenId);
  const wrongChain = walletChain !== chainId;
  const listingCurrency: ListingCurrencyCode =
    listingCurrencyCodesForChain(chainId)[0] ?? "USD";

  const ownerMinPrice1e8 = BigInt(listing.ownerMinPrice1e8 ?? "0");

  const [priceInput, setPriceInput] = useState(() =>
    initialPriceInput(listing.fiatPrice1e8),
  );
  const [commissionInput, setCommissionInput] = useState(() =>
    initialCommissionPct(listing.agentFeeBps),
  );
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
    if (!isAgentWallet) return "Connect the agent wallet to update this listing.";
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

  const runUpdateListing = useCallback(async () => {
    if (!market || !canSubmitNet || price1e8 == null || !validCommission) return;
    if (wrongChain) await switchChainAsync?.({ chainId: wc });
    setTxError(null);
    try {
      const hash = await writeContractAsync({
        address: market,
        abi: MarketplaceEscrowAbi,
        functionName: "updateListing",
        args: [tid, price1e8, agentFeeBps],
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
    writeContractAsync,
    tid,
    agentFeeBps,
    config,
    onSuccess,
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
          disabled={isPending}
          className="border-border-default bg-bg-card"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={`update-commission-${tokenId}`}>Your commission (%)</Label>
        <Input
          id={`update-commission-${tokenId}`}
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
        onClick={() => void runUpdateListing()}
      >
        Update listing
      </Button>
    </div>
  );
}
