"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { erc20Abi, formatUnits, isAddressEqual, zeroAddress } from "viem";
import {
  useAccount,
  useBalance,
  useChainId,
  useReadContract,
  useSimulateContract,
  useSwitchChain,
  useWriteContract,
} from "wagmi";

import { BuyRiskModal } from "@/components/marketplace/buy-risk-modal";
import { CommercePausedNotice } from "@/components/commerce/commerce-paused-notice";
import { DirectPaymentNote } from "@/components/marketplace/direct-payment-note";
import { ListingDisplayPrice } from "@/components/marketplace/listing-display-price";
import { Button } from "@/components/ui/button";
import { WalletLoginButton } from "@/components/wallet-login-button";
import { useClaimAssetMeta } from "@/hooks/use-claim-asset-meta";
import { useCommerceModePaused } from "@/hooks/use-commerce-mode-paused";
import { TX_SYNC_LAG_ADVISORY, useTxSync } from "@/hooks/use-tx-sync";
import { commerceModeAddress } from "@/lib/commerce/mode";
import { FixedPriceConsignmentAbi } from "@/lib/contracts/abis.generated";
import { fiatCurrencyLabel, formatFiat1e8 } from "@/lib/marketplace/fiat-format";
import { normalizeListingFiatCurrency } from "@/lib/marketplace/price-normalize";
import { FIXED_PRICE_R1_DISCLOSURE } from "@/lib/marketplace/fixed-price-r1-disclosure";
import { decodeSettlementNote } from "@/lib/marketplace/settlement-note";
import { txErrorMessage } from "@/lib/marketplace/tx-error-message";
import { needsBuyRiskAck } from "@/lib/passport/trust-signals";
import type { PassportStatus } from "@/lib/types/ponder";
import { wagmiChainId, shortChainName } from "@/lib/web3/supported-chains";
import { useKeyedReadContracts } from "@/lib/web3/keyed-multicall";
import { cn } from "@/lib/utils";

type Props = {
  chainId: number;
  tokenId: string;
  listing: { seller: `0x${string}`; fiatPrice1e8: string; fiatCurrency: number };
  passportStatus: PassportStatus;
  duplicateVin: boolean;
  hadDispute: boolean;
  directPaymentNote?: string;
};

function DisclosureRow({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="font-sans text-xs text-text-tertiary">{label}</span>
      <span
        className={cn(
          "font-mono text-sm text-text-primary text-right",
          valueClassName,
        )}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Buyer checkout for a fixed-price consignment. The settlement asset is fixed
 * when the sale opens: native when the asset is the zero address, otherwise an
 * approved ERC-20.
 */
export function ListingBuyPanel({
  chainId,
  tokenId,
  listing,
  passportStatus,
  duplicateVin,
  hadDispute,
  directPaymentNote: directPaymentNoteProp,
}: Props) {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const walletChain = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync, isPending } = useWriteContract();
  const [riskOpen, setRiskOpen] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);
  const { runTx, awaitReceipt, phase, error, syncLagged } = useTxSync(chainId);

  const market = commerceModeAddress("fixedPrice", chainId);
  const wc = wagmiChainId(chainId);
  const wrongChain = walletChain !== chainId;
  const tid = BigInt(tokenId);
  const requiresRiskAck = needsBuyRiskAck({ passportStatus, duplicateVin });
  const { paused: modePaused } = useCommerceModePaused({
    mode: "fixedPrice",
    chainId,
  });

  const { data: settlementNoteRaw } = useReadContract({
    address: market,
    abi: FixedPriceConsignmentAbi,
    functionName: "settlementNotes",
    args: [tid],
    chainId: wc,
    query: {
      enabled: Boolean(market) && directPaymentNoteProp === undefined,
    },
  });

  const directPaymentNote =
    directPaymentNoteProp ?? decodeSettlementNote(settlementNoteRaw).trim();

  const saleReads = useKeyedReadContracts({
    contracts: market
      ? [
          {
            key: "quoteBuy" as const,
            address: market,
            abi: FixedPriceConsignmentAbi,
            functionName: "quoteBuy",
            args: [tid],
            chainId: wc,
          },
          {
            key: "consignmentAssetOf" as const,
            address: market,
            abi: FixedPriceConsignmentAbi,
            functionName: "consignmentAssetOf",
            args: [tid],
            chainId: wc,
          },
        ]
      : [],
  });
  const isQuoteLoading = saleReads.isLoading;

  const quoteEntry = saleReads.entry("quoteBuy");
  const assetEntry = saleReads.entry("consignmentAssetOf");

  const quote =
    quoteEntry?.status === "success" && quoteEntry.result != null
      ? (quoteEntry.result as bigint)
      : undefined;
  const asset =
    assetEntry?.status === "success"
      ? (assetEntry.result as `0x${string}`)
      : undefined;

  const quoteUnavailable =
    quoteEntry?.status === "failure" || (!isQuoteLoading && quote == null);
  const isNative = asset != null && isAddressEqual(asset, zeroAddress);
  const assetMeta = useClaimAssetMeta({
    chainId: wc,
    asset: asset ?? zeroAddress,
    isNative: asset == null || isNative,
  });

  const {
    data: allowance,
    isLoading: isAllowanceLoading,
    refetch: refetchAllowance,
  } = useReadContract({
    address: asset,
    abi: erc20Abi,
    functionName: "allowance",
    args: address && market ? [address, market] : undefined,
    chainId: wc,
    query: { enabled: Boolean(asset && !isNative && address && market) },
  });

  const { data: erc20Balance } = useReadContract({
    address: asset,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: wc,
    query: { enabled: Boolean(asset && !isNative && address) },
  });

  const { data: nativeBalance } = useBalance({
    address,
    chainId: wc,
    query: { enabled: Boolean(address && isNative) },
  });

  const listingCurrency = normalizeListingFiatCurrency(listing.fiatCurrency);
  const isSeller = Boolean(
    address &&
      listing.seller &&
      address.toLowerCase() === listing.seller.toLowerCase(),
  );

  const sellerReceives = `${formatFiat1e8(BigInt(listing.fiatPrice1e8))} ${fiatCurrencyLabel(listingCurrency)}`;

  const needsApproval = useMemo(() => {
    if (isNative || allowance == null || quote == null) return false;
    return allowance < quote;
  }, [isNative, allowance, quote]);

  const insufficientBalance = useMemo(() => {
    if (quote == null) return false;
    if (isNative) {
      return nativeBalance != null && nativeBalance.value < quote;
    }
    return erc20Balance != null && erc20Balance < quote;
  }, [quote, isNative, nativeBalance, erc20Balance]);

  const canSimulate = Boolean(
    address &&
      market &&
      quote != null &&
      !quoteUnavailable &&
      !needsApproval &&
      !insufficientBalance,
  );

  const { error: simulateError } = useSimulateContract({
    address: market,
    abi: FixedPriceConsignmentAbi,
    functionName: "buy",
    args: [tid],
    value: isNative ? quote : 0n,
    chainId: wc,
    query: { enabled: canSimulate },
  });

  const executeBuy = useCallback(async () => {
    setTxError(null);
    if (!market || quote == null) return;
    try {
      if (wrongChain) await switchChainAsync?.({ chainId: wc });

      if (!isNative && asset && (allowance ?? 0n) < quote) {
        const hash = await writeContractAsync({
          address: asset,
          abi: erc20Abi,
          functionName: "approve",
          args: [market, quote],
        });
        await awaitReceipt(hash);
        await refetchAllowance();
        return;
      }

      if (simulateError) {
        setTxError(txErrorMessage(simulateError));
        return;
      }

      const succeeded = await runTx(() =>
        writeContractAsync({
          address: market,
          abi: FixedPriceConsignmentAbi,
          functionName: "buy",
          args: [tid],
          value: isNative ? quote : 0n,
        }),
      );
      if (succeeded) {
        router.push(`/marketplace/${tokenId}/purchased?chain=${chainId}`);
      }
    } catch (err) {
      setTxError(txErrorMessage(err));
    }
  }, [
    market,
    quote,
    wrongChain,
    switchChainAsync,
    wc,
    isNative,
    asset,
    allowance,
    writeContractAsync,
    awaitReceipt,
    refetchAllowance,
    simulateError,
    runTx,
    tid,
    router,
    tokenId,
    chainId,
  ]);

  const handleBuyClick = () => {
    if (requiresRiskAck) {
      setTxError(null);
      setRiskOpen(true);
      return;
    }
    void executeBuy();
  };

  const youPay = (() => {
    if (isQuoteLoading) return "—";
    if (quoteUnavailable || quote == null) return "Unavailable";
    const decimals = assetMeta.decimals ?? 18;
    const symbol = assetMeta.symbol ?? assetMeta.nativeSymbol;
    return `${formatUnits(quote, decimals)} ${symbol}`;
  })();

  const buyDisabled =
    modePaused === true ||
    isPending ||
    phase !== "idle" ||
    quote == null ||
    quoteUnavailable ||
    insufficientBalance ||
    (!isNative && isAllowanceLoading);

  const buyLabel =
    phase !== "idle"
      ? "Confirming…"
      : needsApproval
        ? `Approve ${assetMeta.symbol ?? "token"}`
        : "Buy now";

  const priceBlock = (
    <div className="rounded-md border border-border-default bg-bg-surface p-4 space-y-2">
      <ListingDisplayPrice
        fiatPrice1e8={listing.fiatPrice1e8}
        fiatCurrency={listing.fiatCurrency}
        showLabel
        label="asking"
      />
      <p className="font-sans text-xs text-text-secondary">
        Checkout settles in {assetMeta.symbol ?? assetMeta.nativeSymbol}.
      </p>
    </div>
  );

  const directPaymentBlock =
    directPaymentNote.length > 0 ? (
      <DirectPaymentNote
        note={directPaymentNote}
        fiatPrice1e8={listing.fiatPrice1e8}
        fiatCurrency={listing.fiatCurrency}
      />
    ) : null;

  if (!isConnected) {
    return (
      <div className="space-y-3">
        {priceBlock}
        {directPaymentBlock}
        <div className="space-y-3 rounded-md border border-border-default bg-bg-surface p-4">
          <p className="text-sm text-text-secondary">Connect wallet to buy</p>
          <WalletLoginButton />
        </div>
      </div>
    );
  }

  if (isSeller) {
    return (
      <div className="space-y-3">
        {priceBlock}
        <p className="text-sm text-text-secondary">You listed this vehicle.</p>
        {directPaymentBlock ? (
          <>
            <p className="font-sans text-xs text-text-tertiary">
              Buyers see these direct payment instructions.
            </p>
            {directPaymentBlock}
          </>
        ) : null}
      </div>
    );
  }

  if (wrongChain) {
    return (
      <div className="space-y-3">
        {priceBlock}
        <div className="space-y-3 rounded-md border border-border-default bg-bg-surface p-4">
          <p className="text-sm text-text-secondary">
            Switch to {shortChainName(chainId)}
          </p>
          <Button
            type="button"
            onClick={() => void switchChainAsync?.({ chainId: wc })}
          >
            Switch network
          </Button>
        </div>
      </div>
    );
  }

  if (!market) {
    return (
      <div className="space-y-3">
        {priceBlock}
        <p className="text-sm text-status-error">
          Fixed price sales are not available on this chain.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4 rounded-md border border-border-default bg-bg-surface p-4">
        <ListingDisplayPrice
          fiatPrice1e8={listing.fiatPrice1e8}
          fiatCurrency={listing.fiatCurrency}
          showLabel
          label="asking"
        />

        {directPaymentBlock}

        {modePaused === true ? (
          <CommercePausedNotice mode="fixedPrice" />
        ) : null}

        <div className="space-y-3 rounded-md border border-border-default bg-bg-surface p-4">
          <DisclosureRow label="Seller receives" value={sellerReceives} />
          <DisclosureRow
            label="You pay"
            value={youPay}
            valueClassName="text-xs text-text-secondary"
          />
          <DisclosureRow
            label="Rate at settlement"
            value={
              isQuoteLoading
                ? "—"
                : quoteUnavailable
                  ? "Unavailable"
                  : "Locked at transaction time"
            }
            valueClassName="text-xs text-text-secondary"
          />
          <p className="font-sans text-xs text-text-tertiary">
            Seller receives is after the platform fee (and any agent share)
            snapshotted when the sale opened.
          </p>
        </div>

        <p className="font-sans text-xs text-text-secondary">
          {FIXED_PRICE_R1_DISCLOSURE}
        </p>

        <Button
          type="button"
          className="w-full"
          disabled={buyDisabled}
          onClick={handleBuyClick}
        >
          {buyLabel}
        </Button>
        {insufficientBalance && (
          <p className="text-sm text-text-secondary">
            Insufficient {assetMeta.symbol ?? assetMeta.nativeSymbol} balance.
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
      </div>

      <BuyRiskModal
        open={riskOpen}
        onOpenChange={setRiskOpen}
        passportStatus={passportStatus}
        duplicateVin={duplicateVin}
        hadDispute={hadDispute}
        tokenId={tokenId}
        onConfirm={() => {
          setRiskOpen(false);
          void executeBuy();
        }}
        isPending={isPending || phase !== "idle"}
      />
    </>
  );
}
