import Link from "next/link";

import { ListingCommentsProvider } from "@/components/passport/listing-comments-provider";
import { PassportCommerce } from "@/components/passport/passport-commerce";
import { PassportDataStrip } from "@/components/passport/passport-data-strip";
import { PassportDetailTabs } from "@/components/passport/passport-detail-tabs";
import { PassportDiscussionRail } from "@/components/passport/passport-discussion-rail";
import { PassportMobileDiscussion } from "@/components/passport/passport-mobile-discussion";
import { PassportIndexerSyncBanner } from "@/components/passport/passport-indexer-sync-banner";
import { PassportIdLabel } from "@/components/passport/passport-id-label";
import { PassportPanelLink } from "@/components/passport/passport-panel-link";
import { PassportPhotoGallery } from "@/components/passport/passport-photo-gallery";
import { PassportActionsPanel } from "@/components/passport/passport-actions-panel";
import {
  PassportPresenceStatusBadge,
  PassportPresenceVerified,
} from "@/components/passport/passport-presence-status";
import { PassportRecordsTimeline } from "@/components/passport/passport-records-timeline";
import { PassportSpecGrid } from "@/components/passport/passport-spec-grid";
import { PassportUriHistory } from "@/components/passport/passport-uri-history";
import { PassportChainStatusBanner } from "@/components/passport/passport-chain-status-banner";
import { PassportTrustBanner } from "@/components/passport/passport-trust-banner";
import type { AuctionRow } from "@/lib/auction/map-ponder-auction";
import {
  elevatedAdvisoryPanel,
  elevatedAdvisoryText,
} from "@/lib/design/instrument-classes";
import { resolvePassportCustody } from "@/lib/marketplace/passport-custody";
import type { PassportMetadata } from "@/lib/passport/fetch-arweave-metadata";
import { formatKarPassportTitle } from "@/lib/passport/passport-token-id";
import { getDisputeBannerText } from "@/lib/passport/record-types";
import { showFixedAfterDisputeBanner } from "@/lib/passport/trust-signals";
import type { PonderPassportDetail } from "@/lib/types/ponder";
import { shortAddress } from "@/lib/web3/wallet-display";
import { cn } from "@/lib/utils";

type Props = {
  tokenId: string;
  /** Custody chain — commerce RPCs and panels. */
  chainId: number;
  /** Origin / mint home — titles and id labels. */
  originChainId?: number;
  passport: PonderPassportDetail;
  metadata: PassportMetadata | null;
  metadataError?: boolean;
  indexerPending?: boolean;
  listing?: {
    active: boolean;
    fiatPrice1e8: string;
    fiatCurrency: number;
    seller: `0x${string}`;
    agent?: string;
    returnRequestedAt?: string | number;
    externalPaymentConfirmedAt?: string | number;
  } | null;
  auction?: AuctionRow | null;
};

function buildTitle(metadata: PassportMetadata | null, tokenId: string, chainId: number): string {
  if (metadata?.name?.trim()) return metadata.name.trim();
  if (metadata?.year && metadata.make && metadata.model) {
    return `${metadata.year} ${metadata.make} ${metadata.model}`;
  }
  if (metadata?.make && metadata.model) {
    return `${metadata.make} ${metadata.model}`;
  }
  return formatKarPassportTitle(tokenId, chainId);
}

function isValidWalletAddress(address: string): boolean {
  return (
    Boolean(address.trim()) &&
    address !== "0x0000000000000000000000000000000000000000"
  );
}

function sealSublabel(status: PonderPassportDetail["status"], verifier: string): string | undefined {
  if (status === "DISPUTED") return "under review";
  if (status === "VERIFIED" && isValidWalletAddress(verifier)) {
    return shortAddress(verifier);
  }
  return undefined;
}

export function PassportDetailView({
  tokenId,
  chainId,
  originChainId,
  passport,
  metadata,
  metadataError,
  indexerPending = false,
  listing = null,
  auction = null,
}: Props) {
  const titleChainId = originChainId ?? passport.chainId ?? chainId;
  const title = buildTitle(metadata, tokenId, titleChainId);
  const isDisputed = passport.status === "DISPUTED";
  const disputeBannerText = getDisputeBannerText({
    disputeReason: passport.disputeReason,
    fallback:
      "Community review in progress: one or more discrepancy reports were submitted for this passport.",
  });
  const showG2Banner = showFixedAfterDisputeBanner(passport);
  const custody = resolvePassportCustody({
    chainId,
    passportOwner: passport.owner as `0x${string}`,
    listing,
  });
  const statusSublabel = sealSublabel(passport.status, passport.verifier);

  const commerce = (
    <PassportCommerce
      chainId={chainId}
      tokenId={tokenId}
      listing={listing}
      initialAuction={auction}
      passportOwner={passport.owner as `0x${string}`}
      passportStatus={passport.status}
      duplicateVin={passport.duplicateVin}
      hadDispute={passport.hadDispute}
    />
  );

  const overview = (
    <>
      {metadata?.description && (
        <section>
          <p className="max-w-3xl font-sans text-base font-normal leading-[1.7] text-text-primary">
            {metadata.description}
          </p>
        </section>
      )}

      <section className="mt-7 space-y-4">
        <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-text-tertiary">
          Attributes
        </p>
        <PassportSpecGrid metadata={metadata} metadataError={metadataError} />
      </section>

      <PassportMobileDiscussion tokenId={tokenId} />
    </>
  );

  const records = (
    <div className="space-y-6">
      <PassportRecordsTimeline
        records={passport.records}
        passportOwner={passport.owner}
        lastDisputer={passport.lastDisputer}
        disputeReason={passport.disputeReason}
        lastDisputeTerminal={passport.lastDisputeTerminal}
        lastDisputeResolvedAt={passport.lastDisputeResolvedAt}
        disputeWithdrawnAt={passport.disputeWithdrawnAt}
      />
      <PassportUriHistory entries={passport.uriHistory} chainId={chainId} />
    </div>
  );

  const actions = (
    <PassportActionsPanel
      tokenId={tokenId}
      chainId={chainId}
      ponderCustodyChain={passport.custodyChain}
      passportOwner={passport.owner as `0x${string}`}
      status={passport.status}
      lastDisputer={passport.lastDisputer}
      recordedVerifier={passport.verifier}
      disputeOpenedAt={passport.disputeOpenedAt}
      duplicateVin={passport.duplicateVin}
      listingActive={listing?.active}
      listingSeller={listing?.seller}
      tokenUri={passport.tokenUri}
      currentMetadata={metadata}
      uriHistory={passport.uriHistory}
      verificationResetCount={passport.verificationResetCount}
      lastVerificationResetAt={passport.lastVerificationResetAt}
    />
  );

  return (
    <div className="mx-auto w-full max-w-7xl px-6 pb-16 pt-8 text-text-primary md:px-8 md:pt-12 xl:max-w-[80rem]">
      <Link href={`/?chain=${chainId}`} className="font-sans text-sm link-underline">
        ← Back to marketplace
      </Link>

      {indexerPending && (
        <div className="mt-8">
          <PassportIndexerSyncBanner tokenId={tokenId} chainId={chainId} />
        </div>
      )}

      <ListingCommentsProvider tokenId={tokenId}>
        <div className="mt-8 grid grid-cols-1 gap-8 md:grid-cols-[1fr_22rem] md:items-start">
          <div className="min-w-0">
            <div className="flex items-start justify-between gap-4">
              <h1 className="min-w-0 max-w-[min(100%,32rem)] font-display text-fluid-display font-medium tracking-[-0.02em] leading-[1.1] text-text-primary">
                {title}
              </h1>
              <PassportPresenceStatusBadge
                tokenId={tokenId}
                chainId={chainId}
                ponderCustodyChain={passport.custodyChain}
                recordedStatus={passport.status}
                sublabel={statusSublabel}
                className="shrink-0"
              />
            </div>

            <div className="mt-2">
              <PassportIdLabel tokenId={tokenId} chainId={titleChainId} variant="eyebrow" />
            </div>

            {isDisputed && (
              <p className="mt-2.5 font-sans text-sm leading-[1.5] text-status-error" role="status">
                Under review — {disputeBannerText}{" "}
                <PassportPanelLink panel="records" className="text-status-error underline">
                  Read the record →
                </PassportPanelLink>
              </p>
            )}

            <div className="mt-5">
              <PassportDataStrip
                listing={listing}
                mileageKm={metadata?.mileageKm ?? null}
                status={passport.status}
                verifier={passport.verifier}
                custody={custody}
              />
            </div>

            <div className="mt-4 space-y-3">
              <PassportChainStatusBanner
                tokenId={tokenId}
                ponderStatus={passport.status}
                chainId={chainId}
              />
              {passport.status !== "DISPUTED" && (
                <PassportTrustBanner
                  verificationResetCount={passport.verificationResetCount}
                  hadDispute={passport.hadDispute}
                  status={passport.status}
                  lastDisputeTerminal={passport.lastDisputeTerminal}
                />
              )}
              {showG2Banner && (
                <div
                  className="rounded-md border border-accent-warm/40 bg-bg-primary/80 p-4"
                  role="status"
                >
                  <p className="font-sans text-sm text-text-primary">
                    Fixed after dispute — awaiting re-verification. Metadata was updated after the
                    last dispute or reset.
                  </p>
                </div>
              )}
              {passport.duplicateVin && (
                <p className={cn(elevatedAdvisoryPanel, elevatedAdvisoryText)} role="status">
                  Duplicate VIN warning — another passport shares this VIN in the index.
                </p>
              )}
            </div>

            <div className="order-1 mt-6 md:hidden">{commerce}</div>

            <div className="mt-6">
              <PassportPresenceVerified
                tokenId={tokenId}
                chainId={chainId}
                ponderCustodyChain={passport.custodyChain}
                recordedStatus={passport.status}
              >
                {(verified) => (
                  <PassportPhotoGallery
                    photos={metadata?.photos ?? []}
                    chainId={chainId}
                    verified={verified}
                  />
                )}
              </PassportPresenceVerified>
            </div>

            <PassportDetailTabs
              status={passport.status}
              passportOwner={passport.owner as `0x${string}`}
              chainId={chainId}
              tokenId={tokenId}
              overview={overview}
              records={records}
              actions={actions}
            />
          </div>

          <aside className="hidden space-y-6 md:sticky md:top-24 md:block">
            {commerce}
            <PassportDiscussionRail tokenId={tokenId} />
          </aside>
        </div>
      </ListingCommentsProvider>
    </div>
  );
}
