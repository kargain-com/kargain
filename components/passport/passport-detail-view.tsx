import Link from "next/link";
import { AlertTriangle, Info } from "lucide-react";

import { ListingDetailClientIsland } from "@/components/marketplace/listing-detail-client-island";
import { PassportIndexerSyncBanner } from "@/components/passport/passport-indexer-sync-banner";
import { PassportInstrumentReadouts } from "@/components/passport/passport-instrument-readouts";
import { PassportPhotoGallery } from "@/components/passport/passport-photo-gallery";
import {
  PassportActionsSlot,
  PassportCommentsSlot,
  PassportDetailPanelChrome,
} from "@/components/passport/passport-detail-panel-chrome";
import { PassportPanelLink } from "@/components/passport/passport-panel-link";
import { PassportRecordsTimeline } from "@/components/passport/passport-records-timeline";
import { PassportSpecGrid } from "@/components/passport/passport-spec-grid";
import { PassportUriHistory } from "@/components/passport/passport-uri-history";
import { WatchlistButton } from "@/components/watchlist/watchlist-button";
import { PassportStatusBadge } from "@/components/ui/passport-status-badge";
import { EnsWalletLink } from "@/components/ui/ens-wallet-link";
import type { PassportMetadata } from "@/lib/passport/fetch-arweave-metadata";
import { formatKarPassportTitle } from "@/lib/passport/passport-token-id";
import { getDisputeBannerText } from "@/lib/passport/record-types";
import { showFixedAfterDisputeBanner } from "@/lib/passport/trust-signals";
import { resolvePassportCustody } from "@/lib/marketplace/passport-custody";
import type { PonderPassportDetail } from "@/lib/types/ponder";

type Props = {
  tokenId: string;
  chainId: number;
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

type DisputeStatusSectionProps = {
  disputeBannerText: string;
  lastDisputer: string;
  disputeWithdrawn: boolean;
};

function DisputeStatusSection({
  disputeBannerText,
  lastDisputer,
  disputeWithdrawn,
}: DisputeStatusSectionProps) {
  const hasDisputer = isValidWalletAddress(lastDisputer);

  return (
    <section
      className="mt-8 rounded-md border border-status-error bg-bg-card p-6"
      role="alert"
      aria-labelledby="dispute-status-heading"
    >
      <div className="flex gap-3">
        <div className="shrink-0 text-status-error mt-0.5">
          <AlertTriangle size={20} strokeWidth={1.5} aria-hidden />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="flex flex-col gap-1">
            <p className="font-mono text-xs font-medium tracking-[0.18em] uppercase text-status-error">
              Disputed
            </p>
            <h2
              id="dispute-status-heading"
              className="font-display text-fluid-h2 font-medium tracking-[-0.015em] leading-[1.15] text-text-primary"
            >
              Passport under review
            </h2>
          </div>

          <div className="flex flex-col gap-1.5">
            <p className="font-mono text-xs font-medium tracking-[0.18em] uppercase text-text-tertiary">
              Reason
            </p>
            <p className="font-sans text-base font-normal leading-[1.6] text-text-primary">
              {disputeBannerText}
            </p>
          </div>

          {hasDisputer && (
            <div className="flex flex-col gap-1.5">
              <p className="font-mono text-xs font-medium tracking-[0.18em] uppercase text-text-tertiary">
                Opened by
              </p>
              <EnsWalletLink
                address={lastDisputer}
                href={`/profile/${lastDisputer}`}
                className="text-base hover:underline"
              />
            </div>
          )}

          {disputeWithdrawn && (
            <div
              className="flex gap-3 rounded-md border border-border-default bg-bg-primary/80 p-4"
              role="status"
            >
              <div className="shrink-0 text-text-secondary mt-0.5">
                <Info size={20} strokeWidth={1.5} aria-hidden />
              </div>
              <p className="font-sans text-sm font-normal leading-[1.5] text-text-secondary">
                Dispute withdrawn (signal only — status stays DISPUTED until a verifier resolves).
              </p>
            </div>
          )}

          <div className="flex flex-col gap-3 border-t border-border-default pt-4">
            <h3 className="font-sans text-base font-medium tracking-tight leading-snug text-text-primary">
              What happens next
            </h3>

            <div className="flex flex-col gap-2">
              <div className="rounded-md border border-border-default bg-bg-surface p-4">
                <p className="font-mono text-xs font-medium tracking-[0.18em] uppercase text-text-tertiary">
                  Buyers
                </p>
                <p className="mt-1.5 font-sans text-sm font-normal leading-[1.5] text-text-secondary">
                  This passport is under review. Review records and evidence before buying.{" "}
                  <Link
                    href="#passport-records"
                    className="link-underline"
                  >
                    View dispute timeline
                  </Link>
                </p>
              </div>

              <div className="rounded-md border border-border-default bg-bg-surface p-4">
                <p className="font-mono text-xs font-medium tracking-[0.18em] uppercase text-text-tertiary">
                  Verifiers
                </p>
                <p className="mt-1.5 font-sans text-sm font-normal leading-[1.5] text-text-secondary">
                  Awaiting your resolution. Use the actions section below to uphold or reject.{" "}
                  <PassportPanelLink panel="actions">Go to actions</PassportPanelLink>
                </p>
              </div>

              <div className="rounded-md border border-border-default bg-bg-surface p-4">
                <p className="font-mono text-xs font-medium tracking-[0.18em] uppercase text-text-tertiary">
                  Owners
                </p>
                <p className="mt-1.5 font-sans text-sm font-normal leading-[1.5] text-text-secondary">
                  Add clarification below so verifiers can review your response.{" "}
                  <PassportPanelLink panel="actions">Go to actions</PassportPanelLink>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function PassportDetailView({
  tokenId,
  chainId,
  passport,
  metadata,
  metadataError,
  indexerPending = false,
  listing = null,
}: Props) {
  const title = buildTitle(metadata, tokenId, chainId);
  const isDisputed = passport.status === "DISPUTED";
  const disputeBannerText = getDisputeBannerText({
    disputeReason: passport.disputeReason,
    fallback:
      "Community review in progress: one or more discrepancy reports were submitted for this passport. Please review records and evidence below.",
  });
  const disputeWithdrawn =
    passport.disputeWithdrawnAt !== "0" &&
    Number.parseInt(passport.disputeWithdrawnAt, 10) > 0;
  const showG2Banner = showFixedAfterDisputeBanner(passport);
  const custody = resolvePassportCustody({
    chainId,
    passportOwner: passport.owner as `0x${string}`,
    listing,
  });

  const gallery = (
    <PassportPhotoGallery
      photos={metadata?.photos ?? []}
      chainId={chainId}
      verified={passport.status === "VERIFIED"}
    />
  );

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-24 text-text-primary md:px-8 xl:max-w-[80rem]">
      <Link
        href={`/?chain=${chainId}`}
        className="font-sans text-sm link-underline"
      >
        ← Back to marketplace
      </Link>

      {indexerPending && (
        <div className="mt-8">
          <PassportIndexerSyncBanner tokenId={tokenId} chainId={chainId} />
        </div>
      )}

      <PassportDetailPanelChrome
        status={passport.status}
        passportOwner={passport.owner as `0x${string}`}
        chainId={chainId}
        tokenId={tokenId}
      >
      {isDisputed && (
        <DisputeStatusSection
          disputeBannerText={disputeBannerText}
          lastDisputer={passport.lastDisputer}
          disputeWithdrawn={disputeWithdrawn}
        />
      )}

      {isDisputed && <div className="mt-8">{gallery}</div>}

      <div className="mt-8 space-y-3">
        <h1 className="font-display text-fluid-display font-medium tracking-[-0.02em] leading-[1.1] text-text-primary">
          {title}
        </h1>
        <PassportStatusBadge status={passport.status} />
      </div>

      <PassportInstrumentReadouts
        tokenId={tokenId}
        chainId={chainId}
        status={passport.status}
        verifier={passport.verifier}
        verifiedAt={passport.verifiedAt}
        custody={custody}
        passportOwner={passport.owner as `0x${string}`}
        verificationResetCount={passport.verificationResetCount}
        hadDispute={passport.hadDispute}
        duplicateVin={passport.duplicateVin}
        showG2Banner={showG2Banner}
      />

        <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_22rem] lg:items-start">
          <div className="order-1 space-y-6 lg:col-start-2 lg:row-start-1 lg:sticky lg:top-24">
            <WatchlistButton tokenId={tokenId} />

            <ListingDetailClientIsland
              chainId={chainId}
              tokenId={tokenId}
              listing={listing}
              passportOwner={passport.owner as `0x${string}`}
              passportStatus={passport.status}
              duplicateVin={passport.duplicateVin}
              hadDispute={passport.hadDispute}
            />
          </div>

          <div className="order-2 space-y-6 lg:col-start-1 lg:row-start-1">
            {!isDisputed && gallery}

            {metadata?.description && (
              <section className="space-y-2">
                <h2 className="font-display text-fluid-h2 font-medium tracking-[-0.015em] text-text-primary">
                  Description
                </h2>
                <p className="font-sans text-base font-normal leading-[1.6] text-text-primary">
                  {metadata.description}
                </p>
              </section>
            )}

            <section className="space-y-4 rounded-md border border-border-default bg-bg-surface p-4 sm:p-6">
              <h2 className="font-display text-fluid-h2 font-medium tracking-[-0.015em] text-text-primary">
                Attributes
              </h2>
              <PassportSpecGrid metadata={metadata} metadataError={metadataError} />
            </section>

            <PassportRecordsTimeline
              records={passport.records}
              passportOwner={passport.owner}
              lastDisputer={passport.lastDisputer}
              disputeReason={passport.disputeReason}
            />

            <PassportActionsSlot
              tokenId={tokenId}
              chainId={chainId}
              passportOwner={passport.owner as `0x${string}`}
              status={passport.status}
              lastDisputer={passport.lastDisputer}
              disputeWithdrawnAt={passport.disputeWithdrawnAt}
              duplicateVin={passport.duplicateVin}
              listingActive={listing?.active}
              listingSeller={listing?.seller}
              tokenUri={passport.tokenUri}
              currentMetadata={metadata}
              uriHistory={passport.uriHistory}
              verificationResetCount={passport.verificationResetCount}
              lastVerificationResetAt={passport.lastVerificationResetAt}
            />

            <PassportCommentsSlot tokenId={tokenId} />

            <PassportUriHistory entries={passport.uriHistory} chainId={chainId} />
          </div>

          <div className="order-3 space-y-6 lg:col-start-2 lg:row-start-2" aria-hidden />
        </div>
      </PassportDetailPanelChrome>
    </div>
  );
}
