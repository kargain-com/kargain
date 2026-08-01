"use client";

import { CircleCheckIcon, CommentIcon } from "@/components/ui/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { erc20Abi } from "viem";

import { OwnerLowerFloorPanel } from "@/components/commerce/owner-lower-floor-panel";
import { ListingAgentBuyerAttribution } from "@/components/marketplace/listing-agent-buyer-attribution";
import { ListingBuyPanel } from "@/components/marketplace/listing-buy-panel";
import { ListingMakeOfferButton } from "@/components/marketplace/listing-make-offer-button";
import { ListingOffersPanel } from "@/components/marketplace/listing-offers-panel";
import { OwnerRecallPanel } from "@/components/commerce/owner-recall-panel";
import { SellerContactButton } from "@/components/marketplace/seller-contact-button";
import { SellerMessagingBanner } from "@/components/marketplace/seller-messaging-banner";
import { Button } from "@/components/ui/button";
import { useListingChainReads } from "@/hooks/use-listing-chain-reads";
import {
  commerceConfirmedLabel,
  commerceConfirmedPanel,
} from "@/lib/design/instrument-classes";
import { KarPassportAbi } from "@/lib/contracts/abis.generated";
import { DENOMINATION_KIND } from "@/lib/commerce/denomination";
import { floorDisplayUnits } from "@/lib/commerce/floor-display";
import { commerceModeAddress, hasCommerceMode } from "@/lib/commerce/mode";
import { isZeroAddress } from "@/lib/commerce/consignment";
import { effectiveRecallRequestedAt } from "@/lib/commerce/recall";
import { resolveEffectiveListing } from "@/lib/marketplace/effective-listing";
import { hasListingAgent } from "@/lib/marketplace/listing-agent";
import { attestedPubkeyForAddress } from "@/lib/nostr/resolve-attested-profile";
import { getNostrPool } from "@/lib/nostr/nostr-client";
import {
  isOnChainNftOwner,
  isPassportHolder,
  resolveEffectiveOnChainOwner,
} from "@/lib/passport/passport-owner";
import type { PassportStatus } from "@/lib/types/ponder";
import { DELIST_BEFORE_AUCTION_HINT } from "@/lib/auction/sale-form-copy";
import { karPassportAddress } from "@/lib/web3/deployment-addresses";
import { useKeyedReadContracts } from "@/lib/web3/keyed-multicall";
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
  const wc = wagmiChainId(chainId);
  const tid = BigInt(tokenId);

  const ownerReads = useKeyedReadContracts({
    contracts: passport
      ? [
          {
            key: "ownerOf" as const,
            address: passport,
            abi: KarPassportAbi,
            functionName: "ownerOf",
            args: [tid],
            chainId: wc,
          },
        ]
      : [],
  });
  const refetchOwner = ownerReads.refetch;

  const commerce = useListingChainReads({ chainId, tokenId });
  const market = commerce.market;

  const onChainOwner = ownerReads.get("ownerOf") as `0x${string}` | undefined;
  const directPaymentNote = commerce.settlementNote;
  const hasDirectPayment = directPaymentNote.length > 0;
  const effectiveOwner = resolveEffectiveOnChainOwner(onChainOwner, passportOwner);

  const chainAgent =
    commerce.agent && !isZeroAddress(commerce.agent) ? commerce.agent : undefined;

  const refetchChainReads = useCallback(() => {
    void refetchOwner();
    void commerce.refetch();
  }, [refetchOwner, commerce]);

  const effectiveListing = useMemo(
    () =>
      resolveEffectiveListing(
        commerce.chainListingRead,
        commerce.listing,
        listing,
      ),
    [commerce.chainListingRead, commerce.listing, listing],
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

  const agentAddress = chainAgent ?? (listing?.agent as `0x${string}` | undefined);
  const listingHasAgent = hasListingAgent(agentAddress);

  const isAgent = Boolean(
    address &&
      listingHasAgent &&
      address.toLowerCase() === agentAddress!.toLowerCase(),
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

  const showRecallFlow = Boolean(isOwner && listingActive && listingHasAgent);
  const recallRequestedAt = effectiveRecallRequestedAt(
    listing?.returnRequestedAt,
    commerce.recallRequestedAt,
  );

  const needsErc20Decimals =
    showRecallFlow &&
    commerce.denominationKind === DENOMINATION_KIND.Asset &&
    Boolean(commerce.asset) &&
    !isZeroAddress(commerce.asset);
  const { data: erc20Decimals } = useReadContract({
    address: commerce.asset,
    abi: erc20Abi,
    functionName: "decimals",
    chainId: wagmiChainId(chainId),
    query: { enabled: needsErc20Decimals },
  });
  const floorUnits = floorDisplayUnits({
    denominationKind: commerce.denominationKind,
    currencyCode: commerce.currencyCode,
    asset: commerce.asset,
    erc20Decimals:
      typeof erc20Decimals === "number" ? erc20Decimals : undefined,
  });
  const showOwnerFloor = Boolean(
    showRecallFlow &&
      commerce.compensationForm != null &&
      floorUnits != null,
  );

  const editHref = `/marketplace/${tokenId}/edit?chain=${chainId}`;
  const showDelistBeforeAuctionHint = Boolean(
    listingActive && isSeller && hasCommerceMode("ascending", chainId),
  );

  const externalPaymentDate = formatChainTimestamp(listing?.externalPaymentConfirmedAt);

  const handleOfferConfirmed = useCallback(() => {
    refetchChainReads();
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
      ) : commerce.isLoading && market ? (
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
          agentAddress={agentAddress}
        />
      )}

      {listingActive && listingHasAgent && agentAddress && (
        <ListingAgentBuyerAttribution
          agentAddress={agentAddress}
          chainId={chainId}
        />
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

      {showOwnerFloor && floorUnits && commerce.compensationForm != null && (
        <OwnerLowerFloorPanel
          mode="fixedPrice"
          chainId={chainId}
          tokenId={tokenId}
          live={listingActive}
          isPassportOwner={isOwner}
          snapshotFloor={commerce.floor}
          floorDecimals={floorUnits.decimals}
          floorUnitLabel={floorUnits.unitLabel}
          compensationForm={commerce.compensationForm}
          onChanged={refetchChainReads}
        />
      )}

      {showRecallFlow && (
        <OwnerRecallPanel
          mode="fixedPrice"
          chainId={chainId}
          tokenId={tokenId}
          recallRequestedAt={recallRequestedAt}
          hasAgent={listingHasAgent}
          onChanged={refetchChainReads}
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
