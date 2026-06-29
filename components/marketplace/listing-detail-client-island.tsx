"use client";

import { MessageCircle } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { useAccount, useReadContracts } from "wagmi";

import { ListingBuyPanel } from "@/components/marketplace/listing-buy-panel";
import { SellerContactButton } from "@/components/marketplace/seller-contact-button";
import { Button } from "@/components/ui/button";
import { KarPassportAbi, MarketplaceEscrowAbi } from "@/lib/contracts/abis.generated";
import { normalizeListingFiatCurrency } from "@/lib/marketplace/price-normalize";
import {
  isOnChainNftOwner,
  isPassportHolder,
  resolveEffectiveOnChainOwner,
} from "@/lib/passport/passport-owner";
import type { PassportStatus } from "@/lib/types/ponder";
import {
  karPassportAddress,
  marketplaceAddress,
} from "@/lib/web3/deployment-addresses";
import { wagmiChainId } from "@/lib/web3/supported-chains";

type ActiveListing = {
  active: true;
  fiatPrice1e8: string;
  fiatCurrency: number;
  seller: `0x${string}`;
};

type ListingProp = {
  active: boolean;
  fiatPrice1e8: string;
  fiatCurrency: number;
  seller: `0x${string}`;
};

type Props = {
  chainId: number;
  tokenId: string;
  listing: ListingProp | null;
  /** Ponder passport owner (fallback while chain loads). */
  passportOwner: `0x${string}`;
  passportStatus: PassportStatus;
  duplicateVin: boolean;
  hadDispute: boolean;
};

function parseOnChainListing(raw: unknown): {
  seller: `0x${string}`;
  fiatPrice1e8: bigint;
  fiat: number;
  active: boolean;
} | null {
  if (raw == null) return null;
  if (typeof raw === "object" && !Array.isArray(raw) && "seller" in raw) {
    const o = raw as {
      seller: `0x${string}`;
      fiatPrice1e8: bigint;
      fiat: number;
      active: boolean;
    };
    return {
      seller: o.seller,
      fiatPrice1e8: o.fiatPrice1e8,
      fiat: Number(o.fiat),
      active: Boolean(o.active),
    };
  }
  if (Array.isArray(raw) && raw.length >= 4) {
    return {
      seller: raw[0] as `0x${string}`,
      fiatPrice1e8: raw[1] as bigint,
      fiat: Number(raw[2]),
      active: Boolean(raw[3]),
    };
  }
  return null;
}

export function ListingDetailClientIsland({
  chainId,
  tokenId,
  listing,
  passportOwner,
  passportStatus,
  duplicateVin,
  hadDispute,
}: Props) {
  const { address, isConnected } = useAccount();

  const passport = karPassportAddress(chainId);
  const market = marketplaceAddress(chainId);
  const wc = wagmiChainId(chainId);
  const tid = BigInt(tokenId);

  const { data: chainReads, isLoading: isChainReadsLoading } = useReadContracts({
    contracts:
      passport && market
        ? [
            {
              address: passport,
              abi: KarPassportAbi,
              functionName: "ownerOf",
              args: [tid],
              chainId: wc,
            },
            {
              address: market,
              abi: MarketplaceEscrowAbi,
              functionName: "listings",
              args: [tid],
              chainId: wc,
            },
          ]
        : [],
  });

  const onChainOwner = chainReads?.[0]?.result as `0x${string}` | undefined;
  const chainRow = parseOnChainListing(chainReads?.[1]?.result);
  const effectiveOwner = resolveEffectiveOnChainOwner(onChainOwner, passportOwner);

  const effectiveListing = useMemo((): ActiveListing | null => {
    if (chainRow?.active) {
      return {
        active: true,
        fiatPrice1e8: String(chainRow.fiatPrice1e8),
        fiatCurrency: chainRow.fiat,
        seller: chainRow.seller,
      };
    }
    if (listing?.active) {
      return {
        active: true,
        fiatPrice1e8: listing.fiatPrice1e8,
        fiatCurrency: normalizeListingFiatCurrency(listing.fiatCurrency),
        seller: listing.seller,
      };
    }
    return null;
  }, [chainRow, listing]);

  const listingActive = Boolean(effectiveListing?.active);
  const listingSeller = effectiveListing?.seller;

  const contactPeer: `0x${string}` | undefined = listingActive
    ? listingSeller
    : effectiveOwner;

  const isSeller = Boolean(
    listingActive &&
    address &&
    listingSeller &&
    address.toLowerCase() === listingSeller.toLowerCase(),
  );

  const isOwner = isOnChainNftOwner(address, effectiveOwner);

  const holder = isPassportHolder({
    address,
    onChainOwner,
    ponderOwner: passportOwner,
    listingActive,
    listingSeller,
  });

  const canManageListing = Boolean(
    market &&
    address &&
    (isSeller || (!listingActive && isOwner)),
  );

  const editHref = `/marketplace/${tokenId}/edit?chain=${chainId}`;
  const manageLabel = listingActive ? "Manage listing" : "List for sale";

  return (
    <div className="space-y-6">
      {listingActive && effectiveListing ? (
        <ListingBuyPanel
          chainId={chainId}
          tokenId={tokenId}
          listing={effectiveListing}
          passportStatus={passportStatus}
          duplicateVin={duplicateVin}
          hadDispute={hadDispute}
        />
      ) : isChainReadsLoading && market ? (
        <p className="rounded-md border border-border-default bg-bg-surface p-4 text-sm text-text-secondary">
          Checking listing…
        </p>
      ) : (
        <p className="rounded-md border border-border-default bg-bg-surface p-4 text-sm text-text-secondary">
          Not currently listed
        </p>
      )}

      {canManageListing && (
        <Button asChild variant="secondary" className="w-full">
          <Link href={editHref}>{manageLabel}</Link>
        </Button>
      )}

      {contactPeer && !holder && !isSeller && (
        <div className="flex flex-wrap gap-2">
          {isConnected ? (
            <SellerContactButton
              peerAddress={contactPeer}
              label="Message seller"
              listingTokenId={listingActive ? tokenId : null}
            />
          ) : (
            <button
              type="button"
              disabled
              aria-label="Message seller"
              className="inline-flex min-h-11 w-full cursor-not-allowed items-center justify-center gap-2 rounded-sm border border-border-default bg-transparent px-7 py-3.5 font-sans text-sm font-medium text-text-secondary opacity-50 disabled:pointer-events-none"
            >
              <MessageCircle size={16} strokeWidth={1.5} aria-hidden />
              Message seller
            </button>
          )}
        </div>
      )}
    </div>
  );
}
