"use client";

import Link from "next/link";
import { useAccount, useChainId, useSwitchChain } from "wagmi";

import { Button } from "@/components/ui/button";
import { WalletLoginButton } from "@/components/wallet-login-button";
import type { getDetailStrings } from "@/lib/i18n/marketplace-detail-locales";
import { wagmiChainId } from "@/lib/web3/supported-chains";

type T = ReturnType<typeof getDetailStrings>;

type Props = {
  chainId: number;
  tokenId: string;
  listing: { seller: `0x${string}`; fiatPrice1e8: string; fiatCurrency: number };
  labels: T;
};

export function ListingBuyPanel({ chainId, tokenId, listing, labels: t }: Props) {
  const { address, isConnected } = useAccount();
  const walletChain = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const wc = wagmiChainId(chainId);

  const marketOk = false;
  const wrongChain = walletChain !== chainId;
  const isSeller =
    Boolean(address && listing.seller && address.toLowerCase() === listing.seller.toLowerCase());

  if (!isConnected) {
    return (
      <div className="space-y-3 rounded-md border border-border-default bg-bg-surface p-4">
        <p className="text-sm text-text-secondary">{t.connectToBuy}</p>
        <WalletLoginButton />
      </div>
    );
  }

  if (isSeller) {
    return (
      <p className="text-sm text-text-secondary">
        {t.youAreSeller}{" "}
        <Link
          href={`/marketplace/${tokenId}/edit?chain=${chainId}`}
          className="font-medium text-accent-warm underline-offset-2 hover:underline"
        >
          {t.editListing}
        </Link>
      </p>
    );
  }

  if (wrongChain) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-text-secondary">{t.wrongNetwork}</p>
        <Button type="button" onClick={() => void switchChainAsync?.({ chainId: wc })}>
          Switch network
        </Button>
      </div>
    );
  }

  if (!marketOk) {
    // TODO Phase 1.1: Marketplace buy flow pending new contract
    return <p className="text-sm text-status-error">Marketplace not configured for this chain.</p>;
  }

  return null;
}
