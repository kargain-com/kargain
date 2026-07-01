"use client";

import { MessageCircle } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useAccount, useReadContracts } from "wagmi";

import { AgentAuthorizationStatus } from "@/components/marketplace/agent-authorization-status";
import { AuthorizeAgentDialog } from "@/components/marketplace/authorize-agent-dialog";
import { ListingBuyPanel } from "@/components/marketplace/listing-buy-panel";
import { OwnerReturnRequestPanel } from "@/components/marketplace/owner-return-request-panel";
import { SellerContactButton } from "@/components/marketplace/seller-contact-button";
import { SellerMessagingBanner } from "@/components/marketplace/seller-messaging-banner";
import { Button } from "@/components/ui/button";
import { KarPassportAbi, MarketplaceEscrowAbi } from "@/lib/contracts/abis.generated";
import { hasListingAgent } from "@/lib/marketplace/listing-agent";
import { parseOnChainListing } from "@/lib/marketplace/parse-on-chain-listing";
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
  agent?: string;
  returnRequestedAt?: string | number;
};

type AgentAuthResult = {
  agent: `0x${string}`;
  expiry: bigint;
  ownerMinPrice1e8: bigint;
  active: boolean;
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
  const [authorizeOpen, setAuthorizeOpen] = useState(false);

  const passport = karPassportAddress(chainId);
  const market = marketplaceAddress(chainId);
  const wc = wagmiChainId(chainId);
  const tid = BigInt(tokenId);

  const {
    data: chainReads,
    isLoading: isChainReadsLoading,
    refetch: refetchChainReads,
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
            {
              address: market,
              abi: MarketplaceEscrowAbi,
              functionName: "returnRequestedAt",
              args: [tid],
              chainId: wc,
            },
          ]
        : [],
  });

  const onChainOwner = chainReads?.[0]?.result as `0x${string}` | undefined;
  const chainRow = parseOnChainListing(chainReads?.[1]?.result);
  const agentAuthRaw = chainReads?.[2]?.result as AgentAuthResult | undefined;
  const chainReturnRequestedAt = chainReads?.[3]?.result as bigint | undefined;
  const effectiveOwner = resolveEffectiveOnChainOwner(onChainOwner, passportOwner);

  const agentAuth = useMemo((): AgentAuthResult | null => {
    if (!agentAuthRaw || !agentAuthRaw.active) return null;
    return {
      agent: agentAuthRaw.agent,
      expiry: BigInt(agentAuthRaw.expiry),
      ownerMinPrice1e8: BigInt(agentAuthRaw.ownerMinPrice1e8),
      active: agentAuthRaw.active,
    };
  }, [agentAuthRaw]);

  const agentAuthActive = agentAuth?.active === true;

  const effectiveListing = useMemo((): ActiveListing | null => {
    if (chainRow?.active) {
      return {
        active: true,
        fiatPrice1e8: String(chainRow.fiatPrice1e8),
        fiatCurrency: normalizeListingFiatCurrency(chainRow.fiatCurrency),
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

  const showDelegateEntry = Boolean(
    isOwner && !listingActive && !agentAuthActive && market && address,
  );

  const showReturnFlow = Boolean(
    isOwner && listingActive && hasListingAgent(listing?.agent),
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

      {isSeller && listingActive && <SellerMessagingBanner />}

      {isOwner && agentAuthActive && agentAuth && (
        <AgentAuthorizationStatus
          chainId={chainId}
          tokenId={tokenId}
          agentAuth={agentAuth}
          listingActive={listingActive}
          onChanged={() => void refetchChainReads()}
        />
      )}

      {showReturnFlow && (
        <OwnerReturnRequestPanel
          chainId={chainId}
          tokenId={tokenId}
          ponderReturnRequestedAt={listing?.returnRequestedAt}
          chainReturnRequestedAt={chainReturnRequestedAt}
          agentAuthActive={agentAuthActive}
          onChanged={() => void refetchChainReads()}
        />
      )}

      {canManageListing && (
        <Button asChild variant="secondary" className="w-full">
          <Link href={editHref}>{manageLabel}</Link>
        </Button>
      )}

      {showDelegateEntry && (
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          onClick={() => setAuthorizeOpen(true)}
        >
          Delegate to a pro
        </Button>
      )}

      <AuthorizeAgentDialog
        chainId={chainId}
        tokenId={tokenId}
        open={authorizeOpen}
        onOpenChange={setAuthorizeOpen}
        onAuthorized={() => void refetchChainReads()}
      />

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
