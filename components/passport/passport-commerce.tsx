"use client";

import { useReadContract } from "wagmi";

import { AuctionDetailClientIsland } from "@/components/auction/auction-detail-client-island";
import { ListingDetailClientIsland } from "@/components/marketplace/listing-detail-client-island";
import { PassportBridgePanel } from "@/components/passport/passport-bridge-panel";
import { PassportSellPanel } from "@/components/passport/passport-sell-panel";
import { WatchlistButton } from "@/components/watchlist/watchlist-button";
import { useAuctionDetail } from "@/hooks/use-auction-detail";
import {
  auctionBlocksListingCommerce,
  marketplaceListingBlocksAuction,
  type AuctionRow,
} from "@/lib/auction/map-ponder-auction";
import { sectionScrollAnchor } from "@/lib/design/instrument-classes";
import { MarketplaceEscrowAbi } from "@/lib/contracts/abis.generated";
import type { BridgeListingState } from "@/lib/passport/bridge-surface";
import type { PassportStatus } from "@/lib/types/ponder";
import {
  auctionEscrowAddress,
  marketplaceAddress,
} from "@/lib/web3/deployment-addresses";
import { wagmiChainId } from "@/lib/web3/supported-chains";
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
 * Passport commerce rail: fixed-price listing XOR live auction (design-spec §4.18).
 * Chain `isListed` + live auction uiState drive the mutex; create auction is never
 * offered while MarketplaceEscrow holds the NFT.
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
  const market = marketplaceAddress(chainId);
  const escrow = auctionEscrowAddress(chainId);
  const tid = BigInt(tokenId);

  const {
    data: isListed,
    isPending: isListedPending,
    isError: isListedError,
  } = useReadContract({
    address: market,
    abi: MarketplaceEscrowAbi,
    functionName: "isListed",
    args: [tid],
    chainId: wagmiChainId(chainId),
    query: { enabled: Boolean(market) },
  });

  const listingBlocksAuction = marketplaceListingBlocksAuction({
    ponderActive: Boolean(listing?.active),
    chainIsListed: isListed,
    chainListedPending: Boolean(market) && isListedPending,
  });

  const detail = useAuctionDetail({
    chainId,
    tokenId,
    initialAuction,
    passportStatus,
    enabled: Boolean(escrow),
  });

  const auctionOwnsCommerce = auctionBlocksListingCommerce(
    detail.uiState,
    detail.auction?.active ?? false,
  );
  const auctionHoldOpen = Boolean(
    detail.hold?.open && detail.hold.releaseAt !== 0n,
  );
  const auctionBlocksSellSurface =
    !escrow
      ? false
      : auctionOwnsCommerce || Boolean(detail.auction?.active) || auctionHoldOpen
        ? true
        : !detail.commerceReadResolved || detail.ponderPending
          ? undefined
          : false;

  const bridgeListingState: BridgeListingState = !market
    ? "failure"
    : isListedPending
      ? "pending"
      : isListedError
        ? "failure"
        : isListed === true
          ? "active"
          : isListed === false
            ? "inactive"
            : "failure";

  return (
    <div id="passport-commerce" className={cn("space-y-4", sectionScrollAnchor)}>
      <WatchlistButton tokenId={tokenId} />
      {auctionOwnsCommerce ? (
        <AuctionDetailClientIsland
          chainId={chainId}
          tokenId={tokenId}
          passportOwner={passportOwner}
          passportStatus={passportStatus}
          listingBlocksAuction={listingBlocksAuction}
          detail={detail}
        />
      ) : (
        <>
          <AuctionDetailClientIsland
            chainId={chainId}
            tokenId={tokenId}
            passportOwner={passportOwner}
            passportStatus={passportStatus}
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
            listing={listing}
            passportOwner={passportOwner}
            passportStatus={passportStatus}
            auctionBlocks={auctionBlocksSellSurface}
            hasActiveAuction={Boolean(detail.auction?.active)}
            now={detail.now}
          />
        </>
      )}
      <PassportBridgePanel
        chainId={chainId}
        tokenId={tokenId}
        passportOwner={passportOwner}
        passportStatus={passportStatus}
        listingState={bridgeListingState}
        auctionBlocks={auctionBlocksSellSurface}
      />
    </div>
  );
}
