"use client";

import { useState } from "react";
import { useAccount, useReadContract } from "wagmi";

import { AgentCreateAuctionPanel } from "@/components/auction/agent-create-auction-panel";
import { AuctionBidHistory } from "@/components/auction/auction-bid-history";
import { AuctionBidPanel } from "@/components/auction/auction-bid-panel";
import { AuctionCancelPanel } from "@/components/auction/auction-cancel-panel";
import { AuctionFinalizePanel } from "@/components/auction/auction-finalize-panel";
import { AuctionReadoutPanel } from "@/components/auction/auction-readout-panel";
import { AuctionReturnAdvisory } from "@/components/auction/auction-return-advisory";
import { AuctionSettlementPanel } from "@/components/auction/auction-settlement-panel";
import { AuthorizeAuctionAgentDialog } from "@/components/auction/authorize-auction-agent-dialog";
import { CreateAuctionPanel } from "@/components/auction/create-auction-panel";
import { OwnerAuctionReturnPanel } from "@/components/auction/owner-auction-return-panel";
import { Button } from "@/components/ui/button";
import { StatusToast } from "@/components/ui/status-toast";
import { useAuctionBids } from "@/hooks/use-auction-bids";
import { useAuctionDetail } from "@/hooks/use-auction-detail";
import { useAuctionLiveSignals } from "@/hooks/use-auction-live-signals";
import {
  hasAuctionAgent,
  isAuctionAuthUsableForCreate,
  parseAuctionAgentAuthorization,
} from "@/lib/auction/auction-agent";
import {
  auctionBlocksListingCommerce,
  type AuctionRow,
} from "@/lib/auction/map-ponder-auction";
import { AuctionEscrowAbi, KarProStakingAbi } from "@/lib/contracts/abis.generated";
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
 * or when owner/agent may authorize or create.
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
  const [authorizeOpen, setAuthorizeOpen] = useState(false);

  const detail = useAuctionDetail({
    chainId,
    tokenId,
    initialAuction,
    passportStatus,
    enabled: Boolean(escrow),
  });

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

  const { data: isActiveVerifier } = useReadContract({
    address: staking,
    abi: KarProStakingAbi,
    functionName: "isActiveVerifier",
    args: address ? [address] : undefined,
    chainId: wagmiChainId(chainId),
    query: { enabled: Boolean(staking && address) },
  });

  const noBlockingAuction =
    !auctionBlocksListingCommerce(uiState, auction?.active ?? false) &&
    !(auction?.active);

  const isOwner =
    Boolean(address) &&
    address!.toLowerCase() === passportOwner.toLowerCase();

  const showCreate =
    isConnected &&
    isOwner &&
    isActiveVerifier === true &&
    passportStatus === "VERIFIED" &&
    !listingActive &&
    noBlockingAuction &&
    (uiState === "NONE" || uiState === "S8" || uiState === "S9");

  const showAuthorize =
    isConnected &&
    isOwner &&
    passportStatus === "VERIFIED" &&
    !listingActive &&
    noBlockingAuction;

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
          !showCreate &&
          noBlockingAuction &&
          !listingActive &&
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
    !listingActive &&
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

  if (
    !showLiveCommerce &&
    !showCreate &&
    !showAuthorize &&
    !showAgentCreate
  ) {
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

      {showAuthorize && (
        <div className="space-y-3 rounded-md border border-border-default bg-bg-surface p-4">
          <p className="font-sans text-sm text-text-secondary">
            Authorize a KarPro to create a reserve auction for this vehicle, or
            revoke an existing authorization before the auction starts.
          </p>
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            onClick={() => setAuthorizeOpen(true)}
          >
            Authorize auction agent
          </Button>
          <AuthorizeAuctionAgentDialog
            chainId={chainId}
            tokenId={tokenId}
            open={authorizeOpen}
            onOpenChange={setAuthorizeOpen}
            hasActiveAuction={Boolean(auction?.active)}
            onAuthorized={() => {
              detail.invalidateAfterTx();
            }}
          />
        </div>
      )}

      {showAgentCreate && (
        <AgentCreateAuctionPanel
          chainId={chainId}
          tokenId={tokenId}
          onSuccess={() => detail.invalidateAfterTx()}
        />
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
