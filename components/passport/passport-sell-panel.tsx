"use client";

import Link from "next/link";
import { useState } from "react";
import { useAccount, useReadContract, useReadContracts } from "wagmi";

import { AuctionAgentAuthorizationStatus } from "@/components/auction/auction-agent-authorization-status";
import { AuthorizeAuctionAgentDialog } from "@/components/auction/authorize-auction-agent-dialog";
import { CreateAuctionPanel } from "@/components/auction/create-auction-panel";
import { AgentAuthorizationStatus } from "@/components/marketplace/agent-authorization-status";
import { AuthorizeAgentDialog } from "@/components/marketplace/authorize-agent-dialog";
import { Button } from "@/components/ui/button";
import {
  AuctionEscrowAbi,
  KarPassportAbi,
  KarProStakingAbi,
  MarketplaceEscrowAbi,
} from "@/lib/contracts/abis.generated";
import { parseAuctionAgentAuthorization } from "@/lib/auction/auction-agent";
import { parseMarketplaceAgentAuthorization } from "@/lib/marketplace/agent-authorization";
import { resolveEffectiveListing } from "@/lib/marketplace/effective-listing";
import { parseOnChainListing } from "@/lib/marketplace/parse-on-chain-listing";
import {
  isOnChainNftOwner,
  resolveEffectiveOnChainOwner,
} from "@/lib/passport/passport-owner";
import {
  deriveSellSurface,
  type SellListingState,
} from "@/lib/passport/sell-surface";
import type { PassportStatus } from "@/lib/types/ponder";
import {
  auctionEscrowAddress,
  karPassportAddress,
  karProStakingAddress,
  marketplaceAddress,
} from "@/lib/web3/deployment-addresses";
import { wagmiChainId } from "@/lib/web3/supported-chains";

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
  passportOwner: `0x${string}`;
  passportStatus: PassportStatus;
  /** `undefined` means shared auction truth is still unresolved. */
  auctionBlocks: boolean | undefined;
  hasActiveAuction: boolean;
  now: number;
  onAuctionChanged: () => void;
};

export function PassportSellPanel({
  chainId,
  tokenId,
  listing,
  passportOwner,
  passportStatus,
  auctionBlocks,
  hasActiveAuction,
  now,
  onAuctionChanged,
}: Props) {
  const { address, isConnected } = useAccount();
  const [marketplaceDialogOpen, setMarketplaceDialogOpen] = useState(false);
  const [auctionDialogOpen, setAuctionDialogOpen] = useState(false);

  const passport = karPassportAddress(chainId);
  const market = marketplaceAddress(chainId);
  const auctionEscrow = auctionEscrowAddress(chainId);
  const staking = karProStakingAddress(chainId);
  const wc = wagmiChainId(chainId);
  const tid = BigInt(tokenId);

  const {
    data: marketplaceReads,
    refetch: refetchMarketplaceReads,
  } = useReadContracts({
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
            {
              address: market,
              abi: MarketplaceEscrowAbi,
              functionName: "agentAuthorizations",
              args: [tid],
              chainId: wc,
            },
          ]
        : [],
    query: {
      enabled: Boolean(isConnected && address && passport && market),
    },
  });

  const {
    data: auctionAuthRaw,
    isSuccess: auctionAuthSuccess,
    refetch: refetchAuctionAuth,
  } = useReadContract({
    address: auctionEscrow,
    abi: AuctionEscrowAbi,
    functionName: "auctionAgentAuthorizations",
    args: [tid],
    chainId: wc,
    query: {
      enabled: Boolean(isConnected && address && auctionEscrow),
    },
  });

  const {
    data: activeVerifier,
    isSuccess: activeVerifierSuccess,
    refetch: refetchActiveVerifier,
  } = useReadContract({
    address: staking,
    abi: KarProStakingAbi,
    functionName: "isActiveVerifier",
    args: address ? [address] : undefined,
    chainId: wc,
    query: {
      enabled: Boolean(isConnected && address && staking),
    },
  });

  const ownerRead = marketplaceReads?.[0];
  const listingRead = marketplaceReads?.[1];
  const marketplaceAuthRead = marketplaceReads?.[2];
  const onChainOwner =
    ownerRead?.status === "success"
      ? (ownerRead.result as `0x${string}`)
      : undefined;
  const effectiveOwner = resolveEffectiveOnChainOwner(
    onChainOwner,
    passportOwner,
  );
  const isOwner =
    ownerRead?.status === "success" &&
    isOnChainNftOwner(address, effectiveOwner);

  const chainListing = parseOnChainListing(
    listingRead?.status === "success" ? listingRead.result : null,
  );
  const effectiveListing =
    listingRead?.status === "success"
      ? resolveEffectiveListing("success", chainListing, listing)
      : null;
  const listingState: SellListingState =
    !passport || !market || listingRead?.status === "failure"
      ? "failure"
      : listingRead?.status === "success"
        ? effectiveListing
          ? "active"
          : "inactive"
        : "pending";

  const marketplaceAuth =
    marketplaceAuthRead?.status === "success"
      ? parseMarketplaceAgentAuthorization(marketplaceAuthRead.result)
      : null;
  const marketplaceAuthActive =
    marketplaceAuthRead?.status === "success"
      ? marketplaceAuth?.active === true
      : undefined;
  const auctionAuth = auctionAuthSuccess
    ? parseAuctionAgentAuthorization(auctionAuthRaw)
    : null;

  const flags = deriveSellSurface({
    isOwner,
    listingState,
    auctionBlocks,
    passportStatus,
    isActiveVerifier: activeVerifierSuccess
      ? activeVerifier === true
      : undefined,
    marketplaceAuthActive,
    auctionAuth: auctionAuthSuccess
      ? { value: auctionAuth, now }
      : undefined,
  });

  const showPanel = Object.values(flags).some(Boolean);
  if (!showPanel) return null;

  const refetchMarketplace = () => {
    void refetchMarketplaceReads();
  };
  const refetchAuction = () => {
    void refetchAuctionAuth();
    void refetchActiveVerifier();
    onAuctionChanged();
  };
  const showAuctionRow =
    flags.showAuctionCreate ||
    flags.showAuctionAuthorize ||
    flags.showAuctionAuthCard;

  return (
    <section className="rounded-md border border-border-default bg-bg-card p-4">
      <h2 className="font-sans text-base font-medium text-text-primary">
        Sell this vehicle
      </h2>

      <div className="mt-4 divide-y divide-border-default">
        {flags.showList && (
          <div className="space-y-3 pb-4">
            <p className="font-sans text-sm text-text-secondary">Fixed price</p>
            <Button asChild variant="secondary" className="w-full">
              <Link href={`/marketplace/${tokenId}/edit?chain=${chainId}`}>
                List for sale
              </Link>
            </Button>
          </div>
        )}

        {(flags.showDelegate || flags.showMarketplaceAuthCard) && (
          <div className="space-y-3 py-4">
            <p className="font-sans text-sm text-text-secondary">Delegation</p>
            {flags.showMarketplaceAuthCard && marketplaceAuth ? (
              <AgentAuthorizationStatus
                chainId={chainId}
                tokenId={tokenId}
                agentAuth={marketplaceAuth}
                listingActive={false}
                onChanged={refetchMarketplace}
              />
            ) : (
              flags.showDelegate && (
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full"
                  onClick={() => setMarketplaceDialogOpen(true)}
                >
                  Delegate to a pro
                </Button>
              )
            )}
          </div>
        )}

        {showAuctionRow && (
          <div className="space-y-3 pt-4">
            <p className="font-sans text-sm text-text-secondary">Auction</p>
            {flags.showAuctionAuthCard && auctionAuth ? (
              <AuctionAgentAuthorizationStatus
                authorization={auctionAuth}
                now={now}
                onManage={() => setAuctionDialogOpen(true)}
              />
            ) : flags.showAuctionCreate ? (
              <CreateAuctionPanel
                chainId={chainId}
                tokenId={tokenId}
                passportStatus={passportStatus}
                listingActive={false}
                isOwner
                isActiveVerifier
                onSuccess={refetchAuction}
              />
            ) : (
              flags.showAuctionAuthorize && (
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full"
                  onClick={() => setAuctionDialogOpen(true)}
                >
                  Authorize auction agent
                </Button>
              )
            )}
          </div>
        )}
      </div>

      {flags.showDelegate && (
        <AuthorizeAgentDialog
          chainId={chainId}
          tokenId={tokenId}
          open={marketplaceDialogOpen}
          onOpenChange={setMarketplaceDialogOpen}
          onAuthorized={refetchMarketplace}
        />
      )}

      {(flags.showAuctionAuthorize || flags.showAuctionAuthCard) && (
        <AuthorizeAuctionAgentDialog
          chainId={chainId}
          tokenId={tokenId}
          open={auctionDialogOpen}
          onOpenChange={setAuctionDialogOpen}
          hasActiveAuction={hasActiveAuction}
          onAuthorized={refetchAuction}
        />
      )}
    </section>
  );
}
