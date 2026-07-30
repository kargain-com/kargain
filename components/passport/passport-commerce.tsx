"use client";

import { AuctionDetailClientIsland } from "@/components/auction/auction-detail-client-island";
import { ListingDetailClientIsland } from "@/components/marketplace/listing-detail-client-island";
import { PassportBridgePanel } from "@/components/passport/passport-bridge-panel";
import { PassportSellPanel } from "@/components/passport/passport-sell-panel";
import { WatchlistButton } from "@/components/watchlist/watchlist-button";
import { useAuctionDetail } from "@/hooks/use-auction-detail";
import { usePassportCommerceFacts } from "@/hooks/use-passport-commerce-facts";
import {
  auctionBlocksListingCommerce,
  marketplaceListingBlocksAuction,
  type AuctionRow,
} from "@/lib/auction/map-ponder-auction";
import { sectionScrollAnchor } from "@/lib/design/instrument-classes";
import type { PassportStatus } from "@/lib/types/ponder";
import { cn } from "@/lib/utils";

type ListingProp = {
  active: boolean;
  fiatPrice1e8: string;
  fiatCurrency: number;
  seller: `0x${string}`;
  agent?: string;
  returnRequestedAt?: string | number;
  externalPaymentConfirmedAt?: string | number;
};

type Props = {
  chainId: number;
  tokenId: string;
  listing: ListingProp | null;
  initialAuction: AuctionRow | null;
  passportOwner: `0x${string}`;
  passportStatus: PassportStatus;
  duplicateVin: boolean;
  hadDispute: boolean;
};

/**
 * Passport commerce rail: fixed-price XOR ascending (design-spec §4.18).
 * Live consignment + `may` drive the mutex — never status-as-permission.
 */
export function PassportCommerce({
  chainId,
  tokenId,
  listing,
  initialAuction,
  passportOwner,
  passportStatus,
  duplicateVin,
  hadDispute,
}: Props) {
  const facts = usePassportCommerceFacts({ chainId, tokenId });

  const listingBlocksAuction = marketplaceListingBlocksAuction({
    ponderActive: Boolean(listing?.active) || Boolean(facts.fixedPrice.live),
    chainIsListed: facts.fixedPrice.live === true,
    chainListedPending: facts.fixedPrice.configured && facts.fixedPrice.live === undefined,
  });

  const detail = useAuctionDetail({
    chainId,
    tokenId,
    initialAuction,
    passportStatus,
    enabled: facts.ascending.configured,
  });

  const auctionOwnsCommerce = auctionBlocksListingCommerce(
    detail.uiState,
    detail.auction?.active ?? false,
  );
  const auctionHoldOpen = Boolean(
    detail.hold?.open && detail.hold.releaseAt !== 0n,
  );
  const ascendingLive =
    facts.ascending.live === true ||
    auctionOwnsCommerce ||
    Boolean(detail.auction?.active) ||
    auctionHoldOpen;

  return (
    <div id="passport-commerce" className={cn("space-y-4", sectionScrollAnchor)}>
      <WatchlistButton tokenId={tokenId} />
      {ascendingLive ? (
        <AuctionDetailClientIsland
          chainId={chainId}
          tokenId={tokenId}
          passportOwner={passportOwner}
          canOpenConsignment={facts.mayOpenConsignment === true}
          listingBlocksAuction={listingBlocksAuction}
          detail={detail}
        />
      ) : (
        <>
          <AuctionDetailClientIsland
            chainId={chainId}
            tokenId={tokenId}
            passportOwner={passportOwner}
            canOpenConsignment={facts.mayOpenConsignment === true}
            listingBlocksAuction={listingBlocksAuction}
            detail={detail}
          />
          <ListingDetailClientIsland
            chainId={chainId}
            tokenId={tokenId}
            listing={listing}
            passportOwner={passportOwner}
            passportStatus={passportStatus}
            duplicateVin={duplicateVin}
            hadDispute={hadDispute}
          />
          <PassportSellPanel
            chainId={chainId}
            tokenId={tokenId}
            passportOwner={passportOwner}
            facts={facts}
            now={detail.now}
          />
        </>
      )}
      <PassportBridgePanel
        chainId={chainId}
        tokenId={tokenId}
        passportOwner={passportOwner}
        mayLeaveChain={facts.mayLeaveChain}
        liveConsignmentMode={facts.liveConsignmentMode}
        challengeOpen={facts.challengeOpen}
      />
    </div>
  );
}
