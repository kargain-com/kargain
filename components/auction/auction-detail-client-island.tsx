"use client";

import { useAccount, useReadContract } from "wagmi";

import { AgentCreateAuctionPanel } from "@/components/auction/agent-create-auction-panel";
import { AuctionBidHistory } from "@/components/auction/auction-bid-history";
import { AuctionBidPanel } from "@/components/auction/auction-bid-panel";
import { AuctionCancelPanel } from "@/components/auction/auction-cancel-panel";
import { AuctionFinalizePanel } from "@/components/auction/auction-finalize-panel";
import { AuctionReadoutPanel } from "@/components/auction/auction-readout-panel";
import { AuctionReturnAdvisory } from "@/components/auction/auction-return-advisory";
import { AuctionSettlementPanel } from "@/components/auction/auction-settlement-panel";
import { OwnerAuctionReturnPanel } from "@/components/auction/owner-auction-return-panel";
import { StatusToast } from "@/components/ui/status-toast";
import { useAuctionBids } from "@/hooks/use-auction-bids";
import type { useAuctionDetail } from "@/hooks/use-auction-detail";
import { useAuctionLiveSignals } from "@/hooks/use-auction-live-signals";
import {
  hasAuctionAgent,
  isAuctionAuthUsableForCreate,
  parseAuctionAgentAuthorization,
} from "@/lib/auction/auction-agent";
import { auctionBlocksListingCommerce } from "@/lib/auction/map-ponder-auction";
import { AuctionEscrowAbi } from "@/lib/contracts/abis.generated";
import type { PassportStatus } from "@/lib/types/ponder";
import { auctionEscrowAddress } from "@/lib/web3/deployment-addresses";
import { wagmiChainId } from "@/lib/web3/supported-chains";

type AuctionDetailController = ReturnType<typeof useAuctionDetail>;

type Props = {
  chainId: number;
  tokenId: string;
  passportOwner: `0x${string}`;
  passportStatus: PassportStatus;
  /**
   * Marketplace fixed-price listing active (or unread — fail-closed).
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
  passportStatus,
  listingBlocksAuction,
  detail,
}: Props) {
  const { address, isConnected } = useAccount();
  const escrow = auctionEscrowAddress(chainId);

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

  const isOwner =
    Boolean(address) &&
    address!.toLowerCase() === passportOwner.toLowerCase();

  /** Single on-demand auth read for agent CTA (not always-on batch). */
  const { data: authRaw } = useReadContract({
    address: escrow,
    abi: AuctionEscrowAbi,
    functionName: "auctionAgentAuthorizations",
    args: [BigInt(tokenId)],
    chainId: wagmiChainId(chainId),
    query: {
      enabled: Boolean(
        escrow &&
          address &&
          noBlockingAuction &&
          !listingBlocksAuction &&
          passportStatus === "VERIFIED",
      ),
    },
  });

  const chainAuth = parseAuctionAgentAuthorization(authRaw);
  const showAgentCreate =
    isConnected &&
    Boolean(address) &&
    isAuctionAuthUsableForCreate(chainAuth, detail.now) &&
    chainAuth != null &&
    address!.toLowerCase() === chainAuth.agent.toLowerCase() &&
    noBlockingAuction &&
    !listingBlocksAuction &&
    passportStatus === "VERIFIED";

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
  const showOwnerReturn =
    Boolean(
      showLiveCommerce &&
        isOwner &&
        preStart &&
        hasAuctionAgent(auction?.agent),
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
              onSuccess={() => detail.invalidateAfterTx()}
            />
          )}

          {uiState === "S1" && (
            <AuctionCancelPanel
              chainId={chainId}
              tokenId={tokenId}
              auction={auction}
              onSuccess={() => detail.invalidateAfterTx()}
            />
          )}

          {showOwnerReturn && (
            <OwnerAuctionReturnPanel
              chainId={chainId}
              tokenId={tokenId}
              returnRequestedAt={returnAt}
              preStart={preStart}
              onChanged={() => detail.invalidateAfterTx()}
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

          {(uiState === "SETTLED" ||
            uiState === "S8" ||
            uiState === "S9") && (
            <AuctionSettlementPanel
              chainId={chainId}
              tokenId={tokenId}
              auction={auction}
              hold={detail.hold}
              now={detail.now}
              settlementDisputeBond={detail.settlementDisputeBond}
              settlementHold={detail.settlementHold}
              disputeResolutionTimeout={detail.disputeResolutionTimeout}
              auctionUiState={uiState as "SETTLED" | "S8" | "S9"}
              onSuccess={() => detail.invalidateAfterTx()}
            />
          )}

          <AuctionBidHistory
            bids={bids.bids}
            assetLabel={auction.assetLabel}
          />
        </>
      )}

      {showAgentCreate && (
        <AgentCreateAuctionPanel
          chainId={chainId}
          tokenId={tokenId}
          onSuccess={() => detail.invalidateAfterTx()}
        />
      )}

    </div>
  );
}
