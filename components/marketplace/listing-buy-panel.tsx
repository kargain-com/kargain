"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { formatUnits } from "viem";
import { waitForTransactionReceipt } from "wagmi/actions";
import {
  useAccount,
  useChainId,
  useReadContracts,
  useSwitchChain,
  useWriteContract,
  useConfig,
} from "wagmi";

import { BuyRiskModal } from "@/components/marketplace/buy-risk-modal";
import { Button } from "@/components/ui/button";
import { WalletLoginButton } from "@/components/wallet-login-button";
import { fiatCurrencyLabel, formatFiat1e8 } from "@/lib/marketplace/fiat-format";
import { needsBuyRiskAck } from "@/lib/passport/trust-signals";
import type { PassportStatus } from "@/lib/types/ponder";
import { MarketplaceEscrowAbi } from "@/lib/contracts/abis.generated";
import { marketplaceAddress } from "@/lib/web3/deployment-addresses";
import { wagmiChainId } from "@/lib/web3/supported-chains";

type Props = {
  chainId: number;
  tokenId: string;
  listing: { seller: `0x${string}`; fiatPrice1e8: string; fiatCurrency: number };
  passportStatus: PassportStatus;
  duplicateVin: boolean;
  hadDispute: boolean;
};

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

  const market = marketplaceAddress(chainId);
  const wc = wagmiChainId(chainId);
  const wrongChain = walletChain !== chainId;
  const tid = BigInt(tokenId);
  const requiresRiskAck = needsBuyRiskAck({ passportStatus, duplicateVin });

  const { data: quoteData } = useReadContracts({
    contracts: market
      ? [
          {
            address: market,
            abi: MarketplaceEscrowAbi,
            functionName: "quoteNativeWei",
            args: [tid],
          },
        ]
      : [],
  });

  const nativeQuote = quoteData?.[0]?.result as bigint | undefined;
  const marketOk = Boolean(market);
  const isSeller =
    Boolean(address && listing.seller && address.toLowerCase() === listing.seller.toLowerCase());

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

  const handleBuyClick = () => {
    if (requiresRiskAck) {
      setRiskOpen(true);
      return;
    }
    void buyNative();
  };

  if (!isConnected) {
    return (
      <div className="space-y-3 rounded-md border border-border-default bg-bg-surface p-4">
        <p className="text-sm text-text-secondary">Connect wallet to buy</p>
        <WalletLoginButton />
      </div>
    );
  }

  if (isSeller) {
    return (
      <p className="text-sm text-text-secondary">
        You listed this vehicle.{" "}
        <Link
          href={`/marketplace/${tokenId}/edit?chain=${chainId}`}
          className="font-medium text-accent-warm underline-offset-2 hover:underline"
        >
          Manage listing
        </Link>
      </p>
    );
  }

  if (wrongChain) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-text-secondary">Switch to Base Sepolia</p>
        <Button type="button" onClick={() => void switchChainAsync?.({ chainId: wc })}>
          Switch network
        </Button>
      </div>
    );
  }

  if (!marketOk) {
    return <p className="text-sm text-status-error">Marketplace not configured for this chain.</p>;
  }

  return (
    <>
      <div className="space-y-4 rounded-md border border-border-default bg-bg-surface p-4">
        <div>
          <p className="text-xs text-text-secondary">Price</p>
          <p className="text-2xl font-medium text-accent-warm">
            {formatFiat1e8(BigInt(listing.fiatPrice1e8))}{" "}
            {fiatCurrencyLabel(listing.fiatCurrency)}
          </p>
          {nativeQuote != null && (
            <p className="mt-1 text-xs text-text-secondary">
              ≈ {formatUnits(nativeQuote, 18)} ETH
            </p>
          )}
        </div>
        <Button
          type="button"
          className="w-full"
          disabled={isPending || nativeQuote == null}
          onClick={handleBuyClick}
        >
          Buy now
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
          void buyNative();
        }}
        isPending={isPending}
      />
    </>
  );
}
