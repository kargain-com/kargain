"use client";

import { FavoriteButton } from "@/components/marketplace/favorite-button";
import { ListingBuyPanel } from "@/components/marketplace/listing-buy-panel";
import { SellerContactButton } from "@/components/marketplace/seller-contact-button";
import type { getDetailStrings } from "@/lib/i18n/marketplace-detail-locales";

type T = ReturnType<typeof getDetailStrings>;

type Props = {
  chainId: number;
  tokenId: string;
  listing: {
    active: boolean;
    fiatPrice1e8: string;
    fiatCurrency: number;
    seller: `0x${string}`;
  } | null;
  /** Current passport holder (marketplace contract while listed). */
  passportOwner: `0x${string}`;
  labels: T;
};

export function ListingDetailClientIsland({ chainId, tokenId, listing, passportOwner, labels: t }: Props) {
  void chainId;
  void tokenId;
  // TODO Phase 1.1: removed — pending new contract

  const contactPeer: `0x${string}` = listing?.active ? listing.seller : passportOwner;

  return (
    <div className="space-y-6">
      {listing?.active ? (
        <ListingBuyPanel chainId={chainId} tokenId={tokenId} listing={listing} labels={t} />
      ) : (
        <p className="rounded-md border border-border-default bg-bg-surface p-4 text-sm text-text-secondary">
          {t.notForSale}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <FavoriteButton chainId={chainId} tokenId={tokenId} />
        <SellerContactButton
          peerAddress={contactPeer}
          label={t.contactSeller}
          listingTokenId={listing?.active ? tokenId : null}
        />
      </div>
    </div>
  );
}
