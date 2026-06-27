"use client";

import { Info } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { waitForTransactionReceipt } from "wagmi/actions";
import {
  useAccount,
  useChainId,
  useReadContract,
  useReadContracts,
  useSwitchChain,
  useWriteContract,
  useConfig,
} from "wagmi";

import { BuyRiskModal } from "@/components/marketplace/buy-risk-modal";
import { ListingDisplayPrice } from "@/components/marketplace/listing-display-price";
import { Button } from "@/components/ui/button";
import { WalletLoginButton } from "@/components/wallet-login-button";
import { fiatCurrencyLabel, formatFiat1e8 } from "@/lib/marketplace/fiat-format";
import { normalizeListingFiatCurrency } from "@/lib/marketplace/price-normalize";
import { needsBuyRiskAck } from "@/lib/passport/trust-signals";
import type { PassportStatus } from "@/lib/types/ponder";
import { MarketplaceEscrowAbi } from "@/lib/contracts/abis.generated";
import { marketplaceAddress, usdcAddress } from "@/lib/web3/deployment-addresses";
import { wagmiChainId } from "@/lib/web3/supported-chains";
import { cn } from "@/lib/utils";

const ETH_SCALE = 1_000_000_000_000_000_000n;
const USDC_SCALE = 1_000_000n;

const ERC20_ABI = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

type PaymentMethod = "ETH" | "USDC";

type Props = {
  chainId: number;
  tokenId: string;
  listing: { seller: `0x${string}`; fiatPrice1e8: string; fiatCurrency: number };
  passportStatus: PassportStatus;
  duplicateVin: boolean;
  hadDispute: boolean;
};

function formatEth4FromWei(ethWei: bigint): string {
  const neg = ethWei < 0n;
  const v = neg ? -ethWei : ethWei;
  const whole = v / ETH_SCALE;
  const fracRaw = v % ETH_SCALE;
  let frac4 = (fracRaw + 5_000_000_000_000_000n) / 10_000_000_000_000_000n;
  let wholePart = whole;
  if (frac4 === 10_000n) {
    wholePart += 1n;
    frac4 = 0n;
  }
  const core = `${wholePart.toString()}.${frac4.toString().padStart(4, "0")}`;
  return `${neg ? `-${core}` : core} ETH`;
}

function formatUsdc2(amount: bigint): string {
  const neg = amount < 0n;
  const v = neg ? -amount : amount;
  const whole = v / USDC_SCALE;
  const fracRaw = v % USDC_SCALE;
  let frac2 = (fracRaw + 5_000n) / 10_000n;
  let wholePart = whole;
  if (frac2 === 100n) {
    wholePart += 1n;
    frac2 = 0n;
  }
  const core = `${wholePart.toString()}.${frac2.toString().padStart(2, "0")}`;
  return `${neg ? `-${core}` : core} USDC`;
}

function formatEthUsdRate(listingUsd1e8: bigint, nativeQuote: bigint): string {
  const ethUsd1e8 = (listingUsd1e8 * ETH_SCALE) / nativeQuote;
  const whole = ethUsd1e8 / 100_000_000n;
  const fracRaw = ethUsd1e8 % 100_000_000n;
  let frac2 = (fracRaw + 500_000n) / 1_000_000n;
  let wholePart = whole;
  if (frac2 === 100n) {
    wholePart += 1n;
    frac2 = 0n;
  }
  return `1 ETH = $${wholePart.toLocaleString("en-US")}.${frac2.toString().padStart(2, "0")}`;
}

function quoteFieldValue(loading: boolean, unavailable: boolean, formatted: string): string {
  if (loading) return "—";
  if (unavailable) return "Unavailable";
  return formatted;
}

function DisclosureRow({ label, value, valueClassName }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="font-sans text-xs text-text-tertiary">{label}</span>
      <span className={cn("font-mono text-sm text-text-primary text-right", valueClassName)}>{value}</span>
    </div>
  );
}

export function ListingBuyPanel({
  chainId,
  tokenId,
  listing,
  passportStatus,
  duplicateVin,
  hadDispute,
}: Props) {
  const config = useConfig();
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const walletChain = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync, isPending } = useWriteContract();
  const [riskOpen, setRiskOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("ETH");

  const market = marketplaceAddress(chainId);
  const usdc = usdcAddress(chainId);
  const wc = wagmiChainId(chainId);
  const wrongChain = walletChain !== chainId;
  const tid = BigInt(tokenId);
  const requiresRiskAck = needsBuyRiskAck({ passportStatus, duplicateVin });

  const { data: quoteData, isLoading: isQuotesLoading } = useReadContracts({
    contracts:
      market && usdc
        ? [
            {
              address: market,
              abi: MarketplaceEscrowAbi,
              functionName: "quoteBuyWithNative",
              args: [tid],
              chainId: wc,
            },
            {
              address: market,
              abi: MarketplaceEscrowAbi,
              functionName: "quoteBuyWithToken",
              args: [tid, usdc],
              chainId: wc,
            },
            {
              address: market,
              abi: MarketplaceEscrowAbi,
              functionName: "listingUsd1e8",
              args: [tid],
              chainId: wc,
            },
          ]
        : [],
  });

  const nativeRead = quoteData?.[0];
  const usdcRead = quoteData?.[1];
  const listingUsdRead = quoteData?.[2];

  const nativeQuote =
    nativeRead?.status === "success" && nativeRead.result != null
      ? (nativeRead.result as bigint)
      : undefined;
  const usdcQuote =
    usdcRead?.status === "success" && usdcRead.result != null
      ? (usdcRead.result as bigint)
      : undefined;
  const listingUsd1e8 =
    listingUsdRead?.status === "success" && listingUsdRead.result != null
      ? (listingUsdRead.result as bigint)
      : undefined;

  const nativeUnavailable =
    nativeRead?.status === "failure" || (!isQuotesLoading && nativeQuote == null);
  const usdcUnavailable =
    usdcRead?.status === "failure" || (!isQuotesLoading && usdcQuote == null);

  const { data: allowance, isLoading: isAllowanceLoading, refetch: refetchAllowance } = useReadContract({
    address: usdc,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: address && market ? [address, market] : undefined,
    chainId: wc,
    query: {
      enabled: Boolean(usdc && address && market),
    },
  });

  const listingCurrency = normalizeListingFiatCurrency(listing.fiatCurrency);
  const marketOk = Boolean(market);
  const isSeller =
    Boolean(address && listing.seller && address.toLowerCase() === listing.seller.toLowerCase());

  const sellerReceives = `${formatFiat1e8(BigInt(listing.fiatPrice1e8))} ${fiatCurrencyLabel(listingCurrency)}`;
  const isEurListing = listingCurrency === 1;

  const needsUsdcApproval = useMemo(() => {
    if (allowance == null || usdcQuote == null) return false;
    return allowance < usdcQuote;
  }, [allowance, usdcQuote]);

  const buyNative = useCallback(async () => {
    if (!market || nativeQuote == null) return;
    if (wrongChain) await switchChainAsync?.({ chainId: wc });
    const hash = await writeContractAsync({
      address: market,
      abi: MarketplaceEscrowAbi,
      functionName: "buyWithNative",
      args: [tid],
      value: nativeQuote,
    });
    await waitForTransactionReceipt(config, { hash });
    router.push(`/marketplace/${tokenId}/purchased?chain=${chainId}`);
  }, [
    chainId,
    config,
    market,
    nativeQuote,
    router,
    switchChainAsync,
    tid,
    tokenId,
    wc,
    wrongChain,
    writeContractAsync,
  ]);

  const buyUsdc = useCallback(async () => {
    if (!market || !usdc || usdcQuote == null) return;
    if (wrongChain) await switchChainAsync?.({ chainId: wc });

    const currentAllowance = allowance ?? 0n;
    if (currentAllowance < usdcQuote) {
      const hash = await writeContractAsync({
        address: usdc,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [market, usdcQuote],
      });
      await waitForTransactionReceipt(config, { hash });
      await refetchAllowance();
      return;
    }

    const hash = await writeContractAsync({
      address: market,
      abi: MarketplaceEscrowAbi,
      functionName: "buyWithToken",
      args: [tid, usdc],
    });
    await waitForTransactionReceipt(config, { hash });
    router.push(`/marketplace/${tokenId}/purchased?chain=${chainId}`);
  }, [
    allowance,
    chainId,
    config,
    market,
    router,
    switchChainAsync,
    tid,
    tokenId,
    usdc,
    usdcQuote,
    wc,
    wrongChain,
    writeContractAsync,
    refetchAllowance,
  ]);

  const executeBuy = paymentMethod === "ETH" ? buyNative : buyUsdc;

  const handleBuyClick = () => {
    if (requiresRiskAck) {
      setRiskOpen(true);
      return;
    }
    void executeBuy();
  };

  const ethYouPay = quoteFieldValue(
    isQuotesLoading,
    nativeUnavailable,
    nativeQuote != null ? formatEth4FromWei(nativeQuote) : "",
  );

  const ethRate =
    !isQuotesLoading &&
    !nativeUnavailable &&
    nativeQuote != null &&
    listingUsd1e8 != null &&
    nativeQuote > 0n
      ? formatEthUsdRate(listingUsd1e8, nativeQuote)
      : quoteFieldValue(isQuotesLoading, nativeUnavailable, "");

  const usdcYouPay = quoteFieldValue(
    isQuotesLoading,
    usdcUnavailable,
    usdcQuote != null ? formatUsdc2(usdcQuote) : "",
  );

  const buyDisabled =
    isPending ||
    (paymentMethod === "ETH"
      ? nativeUnavailable || nativeQuote == null
      : !usdc ||
        usdcUnavailable ||
        usdcQuote == null ||
        isAllowanceLoading);

  const buyLabel =
    paymentMethod === "USDC" && needsUsdcApproval ? "Approve USDC" : "Buy now";

  const usdcOptionDisabled = !usdc || (usdcUnavailable && !isQuotesLoading);

  const priceBlock = (
    <div className="rounded-sm border border-border-default bg-bg-surface p-4">
      <ListingDisplayPrice
        fiatPrice1e8={listing.fiatPrice1e8}
        fiatCurrency={listing.fiatCurrency}
        showLabel
      />
    </div>
  );

  if (!isConnected) {
    return (
      <div className="space-y-3">
        {priceBlock}
        <div className="space-y-3 rounded-sm border border-border-default bg-bg-surface p-4">
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
      </div>
    );
  }

  if (wrongChain) {
    return (
      <div className="space-y-3">
        {priceBlock}
        <div className="space-y-3 rounded-sm border border-border-default bg-bg-surface p-4">
          <p className="text-sm text-text-secondary">Switch to Base Sepolia</p>
          <Button type="button" onClick={() => void switchChainAsync?.({ chainId: wc })}>
            Switch network
          </Button>
        </div>
      </div>
    );
  }

  if (!marketOk) {
    return (
      <div className="space-y-3">
        {priceBlock}
        <p className="text-sm text-status-error">Marketplace not configured for this chain.</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4 rounded-sm border border-border-default bg-bg-surface p-4">
        <ListingDisplayPrice
          fiatPrice1e8={listing.fiatPrice1e8}
          fiatCurrency={listing.fiatCurrency}
          showLabel
        />

        <div className="flex rounded-sm border border-border-default p-0.5">
          <button
            type="button"
            onClick={() => setPaymentMethod("ETH")}
            className={cn(
              "flex-1 h-9 rounded-sm border font-sans text-sm font-medium transition-colors duration-200",
              paymentMethod === "ETH"
                ? "border-border-hover bg-bg-surface text-text-primary"
                : "border-transparent bg-transparent text-text-secondary",
            )}
          >
            Pay with ETH
          </button>
          <button
            type="button"
            disabled={usdcOptionDisabled}
            onClick={() => setPaymentMethod("USDC")}
            className={cn(
              "flex-1 h-9 rounded-sm border font-sans text-sm font-medium transition-colors duration-200",
              paymentMethod === "USDC"
                ? "border-border-hover bg-bg-surface text-text-primary"
                : "border-transparent bg-transparent text-text-secondary",
              usdcOptionDisabled && "cursor-not-allowed opacity-50",
            )}
          >
            Pay with USDC
          </button>
        </div>

        <div className="space-y-3 rounded-sm border border-border-default bg-bg-card p-4">
          <DisclosureRow label="Seller receives" value={sellerReceives} />

          {paymentMethod === "ETH" ? (
            <>
              <DisclosureRow
                label="You pay"
                value={ethYouPay}
                valueClassName="font-medium text-accent-warm"
              />
              <DisclosureRow
                label="Rate at settlement"
                value={ethRate}
                valueClassName="text-xs text-text-secondary"
              />
              {isEurListing && (
                <div className="flex gap-2 rounded-sm bg-bg-surface p-2">
                  <Info size={14} strokeWidth={1.5} className="mt-0.5 shrink-0 text-text-tertiary" aria-hidden />
                  <p className="font-sans text-xs text-text-secondary">
                    Price is set in EUR. ETH amount is calculated at current EUR/USD/ETH rates and
                    locked at transaction time.
                  </p>
                </div>
              )}
            </>
          ) : (
            <>
              <DisclosureRow
                label="You pay"
                value={usdcYouPay}
                valueClassName="font-medium text-accent-warm"
              />
              <DisclosureRow
                label="Rate at settlement"
                value={
                  isQuotesLoading
                    ? "—"
                    : usdcUnavailable
                      ? "Unavailable"
                      : "1 USDC ≈ 1 USD · Rate locked at transaction"
                }
                valueClassName="text-xs text-text-secondary"
              />
              {isEurListing && (
                <div className="flex gap-2 rounded-sm bg-bg-surface p-2">
                  <Info size={14} strokeWidth={1.5} className="mt-0.5 shrink-0 text-text-tertiary" aria-hidden />
                  <p className="font-sans text-xs text-text-secondary">
                    Price is set in EUR. USDC amount is calculated at current EUR/USD rate and locked
                    at transaction time.
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        <Button type="button" className="w-full" disabled={buyDisabled} onClick={handleBuyClick}>
          {buyLabel}
        </Button>
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
        isPending={isPending}
      />
    </>
  );
}
