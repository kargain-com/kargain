"use client";

import { CircleCheckIcon, CommentIcon } from "@/components/ui/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, useReadContracts } from "wagmi";

import { ListingAgentBuyerAttribution } from "@/components/marketplace/listing-agent-buyer-attribution";
import { ListingBuyPanel } from "@/components/marketplace/listing-buy-panel";
import { ListingMakeOfferButton } from "@/components/marketplace/listing-make-offer-button";
import { ListingOffersPanel } from "@/components/marketplace/listing-offers-panel";
import { OwnerReturnRequestPanel } from "@/components/marketplace/owner-return-request-panel";
import { SellerContactButton } from "@/components/marketplace/seller-contact-button";
import { SellerMessagingBanner } from "@/components/marketplace/seller-messaging-banner";
import { Button } from "@/components/ui/button";
import {
  commerceConfirmedLabel,
  commerceConfirmedPanel,
} from "@/lib/design/instrument-classes";
import { KarPassportAbi, MarketplaceEscrowAbi } from "@/lib/contracts/abis.generated";
import { parseMarketplaceAgentAuthorization } from "@/lib/marketplace/agent-authorization";
import {
  resolveEffectiveListing,
  type ChainListingRead,
} from "@/lib/marketplace/effective-listing";
import { hasListingAgent } from "@/lib/marketplace/listing-agent";
import { parseOnChainListing } from "@/lib/marketplace/parse-on-chain-listing";
import { decodeSettlementNote } from "@/lib/marketplace/settlement-note";
import { attestedPubkeyForAddress } from "@/lib/nostr/resolve-attested-profile";
import { getNostrPool } from "@/lib/nostr/nostr-client";
import {
  isOnChainNftOwner,
  isPassportHolder,
  resolveEffectiveOnChainOwner,
} from "@/lib/passport/passport-owner";
import type { PassportStatus } from "@/lib/types/ponder";
import { DELIST_BEFORE_AUCTION_HINT } from "@/lib/auction/sale-form-copy";
import {
  karPassportAddress,
  marketplaceAddress,
  auctionEscrowAddress,
} from "@/lib/web3/deployment-addresses";
import { wagmiChainId } from "@/lib/web3/supported-chains";

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
  /** Ponder passport owner (fallback while chain loads). */
  passportOwner: `0x${string}`;
  passportStatus: PassportStatus;
  duplicateVin: boolean;
  hadDispute: boolean;
};

function formatChainTimestamp(value: string | number | undefined): string {
  const sec = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(sec) || sec <= 0) return "";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(sec * 1000));
}

export function ListingDetailClientIsland({
  chainId,
  tokenId,
  listing,
  passportOwner,
  passportStatus,
  duplicateVin,
  hadDispute,
}: Props) {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const [sellerNostrPubkey, setSellerNostrPubkey] = useState<string | null>(null);

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
            {
              address: market,
              abi: MarketplaceEscrowAbi,
              functionName: "settlementNotes",
              args: [tid],
              chainId: wc,
            },
          ]
        : [],
  });

  const onChainOwner = chainReads?.[0]?.result as `0x${string}` | undefined;
  const listingRead = chainReads?.[1];
  const chainListingRead: ChainListingRead =
    listingRead?.status === "success"
      ? "success"
      : listingRead?.status === "failure"
        ? "failure"
        : "pending";
  const chainRow = parseOnChainListing(
    listingRead?.status === "success" ? listingRead.result : null,
  );
  const agentAuthRaw = parseMarketplaceAgentAuthorization(
    chainReads?.[2]?.result,
  );
  const chainReturnRequestedAt = chainReads?.[3]?.result as bigint | undefined;
  const directPaymentNote = decodeSettlementNote(chainReads?.[4]?.result).trim();
  const hasDirectPayment = directPaymentNote.length > 0;
  const effectiveOwner = resolveEffectiveOnChainOwner(onChainOwner, passportOwner);

  const agentAuth = useMemo(() => {
    if (agentAuthRaw?.active !== true) return null;
    return agentAuthRaw;
  }, [agentAuthRaw]);

  const agentAuthActive = agentAuth?.active === true;

  const effectiveListing = useMemo(
    () => resolveEffectiveListing(chainListingRead, chainRow, listing),
    [chainListingRead, chainRow, listing],
  );

  const listingActive = Boolean(effectiveListing?.active);
  const listingSeller = effectiveListing?.seller;

  const externalPaymentConfirmed = Boolean(
    listing?.externalPaymentConfirmedAt != null &&
      String(listing.externalPaymentConfirmedAt) !== "0",
  );

  const contactPeer: `0x${string}` | undefined = listingActive
    ? listingSeller
    : effectiveOwner;

  const isSeller = Boolean(
    listingActive &&
    address &&
    listingSeller &&
    address.toLowerCase() === listingSeller.toLowerCase(),
  );

  const isAgent = Boolean(
    address &&
      hasListingAgent(listing?.agent) &&
      address.toLowerCase() === listing!.agent!.toLowerCase(),
  );

  const isOwner = isOnChainNftOwner(address, effectiveOwner);

  useEffect(() => {
    if (!listingSeller) {
      setSellerNostrPubkey(null);
      return;
    }
    let cancelled = false;
    void attestedPubkeyForAddress(listingSeller, { pool: getNostrPool() }).then((pubkey) => {
      if (!cancelled) setSellerNostrPubkey(pubkey);
    });
    return () => {
      cancelled = true;
    };
  }, [listingSeller]);

  const holder = isPassportHolder({
    address,
    onChainOwner,
    ponderOwner: passportOwner,
    listingActive,
    listingSeller,
  });

  const canManageListing = Boolean(
    market && address && listingActive && isSeller,
  );

  const showReturnFlow = Boolean(
    isOwner && listingActive && hasListingAgent(listing?.agent),
  );

  const editHref = `/marketplace/${tokenId}/edit?chain=${chainId}`;
  const showDelistBeforeAuctionHint = Boolean(
    listingActive && isSeller && auctionEscrowAddress(chainId),
  );

  const externalPaymentDate = formatChainTimestamp(listing?.externalPaymentConfirmedAt);

  const handleOfferConfirmed = useCallback(() => {
    void refetchChainReads();
    router.refresh();
  }, [refetchChainReads, router]);

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
          directPaymentNote={directPaymentNote}
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

      {!listingActive && externalPaymentConfirmed && (
        <div className={commerceConfirmedPanel} role="status">
          <div className="flex gap-3">
            <div className="shrink-0 text-status-success mt-0.5">
              <CircleCheckIcon size={20} aria-hidden />
            </div>
            <div className="flex flex-col gap-1">
              <p className={commerceConfirmedLabel}>Payment confirmed</p>
              <p className="font-sans text-sm text-text-secondary">
                {externalPaymentDate ? (
                  <>
                    Payment received externally on{" "}
                    <span className="font-mono tabular-nums">{externalPaymentDate}</span>.
                  </>
                ) : (
                  "Payment received externally."
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      {listingActive && hasDirectPayment && listingSeller && (
        <ListingMakeOfferButton
          tokenId={tokenId}
          sellerAddress={listingSeller}
          sellerNostrPubkey={sellerNostrPubkey}
          agentAddress={listing?.agent}
        />
      )}

      {listingActive && hasListingAgent(listing?.agent) && (
        <ListingAgentBuyerAttribution agentAddress={listing!.agent as `0x${string}`} />
      )}

      {isSeller && listingActive && <SellerMessagingBanner />}

      {listingActive &&
        hasDirectPayment &&
        (isSeller || isAgent) &&
        sellerNostrPubkey && (
          <ListingOffersPanel
            chainId={chainId}
            tokenId={tokenId}
            sellerNostrPubkey={sellerNostrPubkey}
            hasDirectPayment={hasDirectPayment}
            onConfirmed={handleOfferConfirmed}
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
        <div className="space-y-2">
          {showDelistBeforeAuctionHint && (
            <p className="font-sans text-sm text-text-secondary" role="status">
              {DELIST_BEFORE_AUCTION_HINT}
            </p>
          )}
          <Button asChild variant="secondary" className="w-full">
            <Link href={editHref}>Manage listing</Link>
          </Button>
        </div>
      )}

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
              <CommentIcon size={16} aria-hidden />
              Message seller
            </button>
          )}
        </div>
      )}
    </div>
  );
}
