"use client";

import { useAccount, useReadContract } from "wagmi";

import { AuctionBidHistory } from "@/components/auction/auction-bid-history";
import { AuctionBidPanel } from "@/components/auction/auction-bid-panel";
import { AuctionFinalizePanel } from "@/components/auction/auction-finalize-panel";
import { AuctionReadoutPanel } from "@/components/auction/auction-readout-panel";
import { CreateAuctionPanel } from "@/components/auction/create-auction-panel";
import { useAuctionBids } from "@/hooks/use-auction-bids";
import { useAuctionDetail } from "@/hooks/use-auction-detail";
import {
  auctionBlocksListingCommerce,
  type AuctionRow,
} from "@/lib/auction/map-ponder-auction";
import { KarProStakingAbi } from "@/lib/contracts/abis.generated";
import type { PassportStatus } from "@/lib/types/ponder";
import {
  auctionEscrowAddress,
  karProStakingAddress,
} from "@/lib/web3/deployment-addresses";
import { wagmiChainId } from "@/lib/web3/supported-chains";

type Props = {
  chainId: number;
  tokenId: string;
  /** Server-prefetched Ponder auction (may be null). */
  initialAuction: AuctionRow | null;
  passportOwner: `0x${string}`;
  passportStatus: PassportStatus;
  /** Marketplace fixed-price listing currently active. */
  listingActive: boolean;
};

/**
 * Lot commerce island for auctions (D3). Mount when auction is active / hold / ended,
 * or when owner may create. Parent enforces mutex vs listing buy panel.
 */
export function AuctionDetailClientIsland({
  chainId,
  tokenId,
  initialAuction,
  passportOwner,
  passportStatus,
  listingActive,
}: Props) {
  const { address, isConnected } = useAccount();
  const escrow = auctionEscrowAddress(chainId);
  const staking = karProStakingAddress(chainId);

  const detail = useAuctionDetail({
    chainId,
    tokenId,
    initialAuction,
    passportStatus,
    enabled: Boolean(escrow),
  });

  const auction = detail.auction;
  const uiState = detail.uiState;

  const { data: isActiveVerifier } = useReadContract({
    address: staking,
    abi: KarProStakingAbi,
    functionName: "isActiveVerifier",
    args: address ? [address] : undefined,
    chainId: wagmiChainId(chainId),
    query: { enabled: Boolean(staking && address) },
  });

  const isOwner =
    Boolean(address) &&
    address!.toLowerCase() === passportOwner.toLowerCase();

  const showCreate =
    isConnected &&
    isOwner &&
    isActiveVerifier === true &&
    passportStatus === "VERIFIED" &&
    !listingActive &&
    !auctionBlocksListingCommerce(uiState, auction?.active ?? false) &&
    (uiState === "NONE" || uiState === "S8" || uiState === "S9") &&
    !(auction?.active);

  const showLiveCommerce =
    auction &&
    (uiState === "S1" ||
      uiState === "S3" ||
      uiState === "S4" ||
      uiState === "S5" ||
      uiState === "SETTLED" ||
      uiState === "S8" ||
      uiState === "S9");

  const bids = useAuctionBids({
    tokenId,
    auctionCreatedAt: auction?.createdAt ?? 0n,
    uiState,
    enabled: Boolean(auction && showLiveCommerce),
  });

  if (!escrow) return null;

  if (!showLiveCommerce && !showCreate) {
    if (detail.chainPending || detail.ponderPending) {
      return (
        <p className="rounded-md border border-border-default bg-bg-surface p-4 text-sm text-text-secondary">
          Checking auction…
        </p>
      );
    }
    return null;
  }

  return (
    <div className="space-y-4">
      {showLiveCommerce && auction && (
        <>
          <AuctionReadoutPanel
            auction={auction}
            uiState={uiState}
            now={detail.now}
            minIncrementBps={detail.minIncrementBps}
          />

          {(uiState === "S1" || uiState === "S3" || uiState === "S4") && (
            <AuctionBidPanel
              chainId={chainId}
              tokenId={tokenId}
              auction={auction}
              uiState={uiState}
              minIncrementBps={detail.minIncrementBps}
              paused={detail.paused}
              onSuccess={() => detail.invalidateAfterTx()}
            />
          )}

          {uiState === "S5" && (
            <AuctionFinalizePanel
              chainId={chainId}
              tokenId={tokenId}
              auction={auction}
              passportStatus={passportStatus}
              onSuccess={() => detail.invalidateAfterTx()}
            />
          )}

          {uiState === "SETTLED" && (
            <div
              className="rounded-md border border-border-default bg-bg-surface p-4"
              role="status"
            >
              <p className="font-sans text-sm text-text-secondary">
                Settlement hold in progress. Confirm receipt and dispute actions
                ship in a later update.
              </p>
            </div>
          )}

          {(uiState === "S8" || uiState === "S9") && auction.voidReason ? (
            <p className="font-sans text-sm text-text-secondary">
              Auction voided — {auction.voidReason}. All bids were refunded
              automatically.
            </p>
          ) : null}

          <AuctionBidHistory
            bids={bids.bids}
            assetLabel={auction.assetLabel}
          />
        </>
      )}

      {showCreate && (
        <CreateAuctionPanel
          chainId={chainId}
          tokenId={tokenId}
          passportStatus={passportStatus}
          listingActive={listingActive}
          isOwner={isOwner}
          isActiveVerifier={isActiveVerifier === true}
          onSuccess={() => detail.invalidateAfterTx()}
        />
      )}
    </div>
  );
}
