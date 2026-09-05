"use client";

import { AuctionDetailClientIsland } from "@/components/auction/auction-detail-client-island";
import { ListingDetailClientIsland } from "@/components/marketplace/listing-detail-client-island";
import { PassportBridgePanel } from "@/components/passport/passport-bridge-panel";
import { PassportEncumbranceRegistry } from "@/components/passport/passport-encumbrance-registry";
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
import { isEncumbrancePermissionAvailable } from "@/lib/passport/encumbrance-permission";
import type { FixedPriceListingDetailProp } from "@/lib/passport/fetch-passport-detail";
import type { PassportStatus } from "@/lib/types/ponder";
import { cn } from "@/lib/utils";

type CommonProps = {
  viewChainId: number;
  tokenId: string;
  listing: FixedPriceListingDetailProp | null;
  initialAuction: AuctionRow | null;
  passportOwner: `0x${string}`;
  passportStatus: PassportStatus;
  custodyUnresolved?: string | null;
  duplicateVin: boolean;
  hadDispute: boolean;
};

type TransitProps = CommonProps & {
  commerceChainId: null;
  transitBridgeChainId: number;
};

type ResolvedProps = CommonProps & {
  commerceChainId: number;
  transitBridgeChainId?: null;
};

type Props = TransitProps | ResolvedProps;

function TransitPassportCommerce({
  transitBridgeChainId,
  tokenId,
  passportOwner,
  passportStatus,
  custodyUnresolved,
}: TransitProps) {
  return (
    <div id="passport-commerce" className={cn("space-y-4", sectionScrollAnchor)}>
      <WatchlistButton tokenId={tokenId} />
      <PassportBridgePanel
        chainId={transitBridgeChainId}
        tokenId={tokenId}
        passportOwner={passportOwner}
        passportStatus={passportStatus}
        custodyUnresolved={custodyUnresolved}
        liveConsignmentMode={null}
        challengeOpen={undefined}
      />
    </div>
  );
}

function ResolvedPassportCommerce({
  commerceChainId,
  tokenId,
  listing,
  initialAuction,
  passportOwner,
  passportStatus,
  custodyUnresolved,
  duplicateVin,
  hadDispute,
}: ResolvedProps) {
  const facts = usePassportCommerceFacts({
    chainId: commerceChainId,
    tokenId,
  });
  const listingBlocksAuction = marketplaceListingBlocksAuction({
    ponderActive: Boolean(listing?.active) || Boolean(facts.fixedPrice.live),
    chainIsListed: facts.fixedPrice.live === true,
    chainListedPending: facts.fixedPrice.configured && facts.fixedPrice.live === undefined,
  });

  const detail = useAuctionDetail({
    chainId: commerceChainId,
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

  const canOpenConsignment = isEncumbrancePermissionAvailable(
    facts.openConsignmentPermission,
  );

  const unanswerableSource =
    facts.openConsignmentPermission.status === "blocked" &&
    facts.openConsignmentPermission.cause === "source_unanswerable"
      ? facts.openConsignmentPermission.source
      : facts.leaveChainPermission.status === "blocked" &&
          facts.leaveChainPermission.cause === "source_unanswerable"
        ? facts.leaveChainPermission.source
        : null;

  return (
    <div id="passport-commerce" className={cn("space-y-4", sectionScrollAnchor)}>
      <WatchlistButton tokenId={tokenId} />
      {ascendingLive ? (
        <AuctionDetailClientIsland
          chainId={commerceChainId}
          tokenId={tokenId}
          passportOwner={passportOwner}
          canOpenConsignment={canOpenConsignment}
          listingBlocksAuction={listingBlocksAuction}
          ponderCustodyChain={commerceChainId}
          custodyUnresolved={custodyUnresolved}
          detail={detail}
        />
      ) : (
        <>
          <AuctionDetailClientIsland
            chainId={commerceChainId}
            tokenId={tokenId}
            passportOwner={passportOwner}
            canOpenConsignment={canOpenConsignment}
            listingBlocksAuction={listingBlocksAuction}
            ponderCustodyChain={commerceChainId}
            custodyUnresolved={custodyUnresolved}
            detail={detail}
          />
          <ListingDetailClientIsland
            chainId={commerceChainId}
            tokenId={tokenId}
            listing={listing}
            passportOwner={passportOwner}
            passportStatus={passportStatus}
            ponderCustodyChain={commerceChainId}
            custodyUnresolved={custodyUnresolved}
            duplicateVin={duplicateVin}
            hadDispute={hadDispute}
          />
          <PassportSellPanel
            chainId={commerceChainId}
            tokenId={tokenId}
            passportOwner={passportOwner}
            passportStatus={passportStatus}
            ponderCustodyChain={commerceChainId}
            custodyUnresolved={custodyUnresolved}
            facts={facts}
            now={detail.now}
          />
        </>
      )}
      <PassportBridgePanel
        chainId={commerceChainId}
        tokenId={tokenId}
        passportOwner={passportOwner}
        passportStatus={passportStatus}
        custodyUnresolved={custodyUnresolved}
        custodyLocked={facts.custodyLocked}
        leaveChainPermission={facts.leaveChainPermission}
        liveConsignmentMode={facts.liveConsignmentMode}
        challengeOpen={facts.challengeOpen}
      />
      <PassportEncumbranceRegistry
        chainId={commerceChainId}
        registry={facts.encumbranceRegistry}
        unanswerableSource={unanswerableSource}
      />
    </div>
  );
}

/**
 * Passport commerce rail: fixed-price XOR ascending (design-spec §4.18).
 * Live consignment + `may` drive the mutex — never status-as-permission.
 */
export function PassportCommerce(props: Props) {
  if (props.commerceChainId == null) {
    return <TransitPassportCommerce {...props} />;
  }
  return <ResolvedPassportCommerce {...props} />;
}
