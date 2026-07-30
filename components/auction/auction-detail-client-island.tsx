"use client";

import { useAccount } from "wagmi";

import { AgentCreateAuctionPanel } from "@/components/auction/agent-create-auction-panel";
import { AuctionBidHistory } from "@/components/auction/auction-bid-history";
import { AuctionBidPanel } from "@/components/auction/auction-bid-panel";
import { AuctionCancelPanel } from "@/components/auction/auction-cancel-panel";
import { AuctionFinalizePanel } from "@/components/auction/auction-finalize-panel";
import { AuctionReadoutPanel } from "@/components/auction/auction-readout-panel";
import { AuctionReturnAdvisory } from "@/components/auction/auction-return-advisory";
import { AuctionSettlementPanel } from "@/components/auction/auction-settlement-panel";
import { OwnerRecallPanel } from "@/components/commerce/owner-recall-panel";
import { StatusToast } from "@/components/ui/status-toast";
import { useAuctionBids } from "@/hooks/use-auction-bids";
import type { useAuctionDetail } from "@/hooks/use-auction-detail";
import { useAuctionLiveSignals } from "@/hooks/use-auction-live-signals";
import { useMandate } from "@/hooks/use-mandate";
import { auctionBlocksListingCommerce } from "@/lib/auction/map-ponder-auction";
import { addressesMatch, isZeroAddress } from "@/lib/commerce/consignment";
import { canAgentOpenFromMandate } from "@/lib/commerce/mandate";
import { commerceModeAddress } from "@/lib/commerce/mode";

type AuctionDetailController = ReturnType<typeof useAuctionDetail>;

type Props = {
  chainId: number;
  tokenId: string;
  passportOwner: `0x${string}`;
  /** `may(tokenId, OpenConsignment)` — fail closed while unresolved. */
  canOpenConsignment: boolean;
  /**
   * Fixed-price consignment live (or unread — fail-closed).
   * Blocks create/authorize; suppresses “Checking auction…” flash.
   */
  listingBlocksAuction: boolean;
  /** Shared detail from PassportCommerce (single fetch). */
  detail: AuctionDetailController;
};

/**
 * Lot commerce island for auctions (D3). Mount when auction is active / hold / ended,
 * or when owner/agent may authorize or create.
 */
export function AuctionDetailClientIsland({
  chainId,
  tokenId,
  passportOwner,
  canOpenConsignment,
  listingBlocksAuction,
  detail,
}: Props) {
  const { address, isConnected } = useAccount();
  const escrow = commerceModeAddress("ascending", chainId);

  const auction = detail.auction;
  const uiState = detail.uiState;

  const liveSignals = useAuctionLiveSignals({
    chainId,
    tokenId,
    endsAt: auction?.endsAt ?? 0n,
    startedAt: auction?.startedAt ?? 0n,
    highestBidder: auction?.highestBidder ?? null,
    highestBid: auction?.highestBid ?? 0n,
    assetLabel: auction?.assetLabel ?? "ETH",
    uiState,
    wallet: address,
    extensionWindow: detail.extensionWindow,
    enabled: Boolean(
      auction &&
        (uiState === "S1" || uiState === "S3" || uiState === "S4"),
    ),
  });

  const noBlockingAuction =
    !auctionBlocksListingCommerce(uiState, auction?.active ?? false) &&
    !(auction?.active);

  const isOwner = addressesMatch(passportOwner, address);

  /** On-demand mandate read for the agent CTA (not part of the lot batch). */
  const { mandate } = useMandate({
    mode: "ascending",
    chainId,
    tokenId,
    enabled: Boolean(
      address && noBlockingAuction && !listingBlocksAuction && canOpenConsignment,
    ),
  });

  const showAgentCreate =
    isConnected &&
    canAgentOpenFromMandate({
      mandate,
      agentAddress: address,
      nowSeconds: detail.now,
    }) &&
    noBlockingAuction &&
    !listingBlocksAuction &&
    canOpenConsignment;

  const showLiveCommerce =
    auction &&
    (uiState === "S1" ||
      uiState === "S3" ||
      uiState === "S4" ||
      uiState === "S5" ||
      uiState === "SETTLED" ||
      uiState === "S8" ||
      uiState === "S9");

  const preStart = Boolean(auction && auction.startedAt === 0n);
  const returnAt = auction?.returnRequestedAt ?? 0n;
  const showReturnAdvisory =
    Boolean(showLiveCommerce && preStart && returnAt > 0n);
  const hasAgent = Boolean(auction?.agent && !isZeroAddress(auction.agent));
  const showOwnerReturn = Boolean(
    showLiveCommerce && isOwner && preStart && hasAgent,
  );

  const bids = useAuctionBids({
    tokenId,
    auctionCreatedAt: auction?.createdAt ?? 0n,
    uiState,
    enabled: Boolean(auction && showLiveCommerce),
  });

  if (!escrow) return null;

  if (!showLiveCommerce && !showAgentCreate) {
    // Listed (or isListed unread): create impossible — do not flash checking UI over Manage listing.
    if (listingBlocksAuction) return null;
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
          {showReturnAdvisory && (
            <AuctionReturnAdvisory returnRequestedAt={returnAt} />
          )}

          <StatusToast
            message={liveSignals.outbidToast}
            onClear={liveSignals.clearOutbidToast}
          />

          <AuctionReadoutPanel
            auction={auction}
            uiState={uiState}
            now={detail.now}
            minIncrementBps={detail.minIncrementBps}
            extensionFlash={liveSignals.extensionFlash}
          />

          {(uiState === "S1" || uiState === "S3" || uiState === "S4") && (
            <AuctionBidPanel
              chainId={chainId}
              tokenId={tokenId}
              auction={auction}
              uiState={uiState}
              minIncrementBps={detail.minIncrementBps}
              paused={detail.paused}
              extensionWindow={detail.extensionWindow}
              extensionFlash={liveSignals.extensionFlash}
            />
          )}

          {uiState === "S1" && (
            <AuctionCancelPanel
              chainId={chainId}
              tokenId={tokenId}
              auction={auction}
            />
          )}

          {showOwnerReturn && (
            <OwnerRecallPanel
              mode="ascending"
              chainId={chainId}
              tokenId={tokenId}
              recallRequestedAt={returnAt}
              hasAgent={hasAgent}
              onChanged={detail.refetch}
            />
          )}

          {uiState === "S5" && (
            <AuctionFinalizePanel
              chainId={chainId}
              tokenId={tokenId}
              auction={auction}
            />
          )}

          {(uiState === "SETTLED" ||
            uiState === "S8" ||
            uiState === "S9") && (
            <AuctionSettlementPanel
              chainId={chainId}
              tokenId={tokenId}
              auction={auction}
              hold={detail.holdSnapshot}
              challenge={detail.challenge}
              now={detail.now}
              challengeBond={detail.challengeBond}
              auctionUiState={uiState as "SETTLED" | "S8" | "S9"}
            />
          )}

          <AuctionBidHistory
            bids={bids.bids}
            assetLabel={auction.assetLabel}
          />
        </>
      )}

      {showAgentCreate && (
        <AgentCreateAuctionPanel chainId={chainId} tokenId={tokenId} />
      )}

    </div>
  );
}
