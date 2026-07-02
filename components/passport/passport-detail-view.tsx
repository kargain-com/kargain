import Link from "next/link";
import { AlertTriangle, Info } from "lucide-react";

import NostrCommentsSection from "@/components/marketplace/nostr-comments-section";
import { ListingDetailClientIsland } from "@/components/marketplace/listing-detail-client-island";
import { PassportActionsPanel } from "@/components/passport/passport-actions-panel";
import { PassportChainStatusBanner } from "@/components/passport/passport-chain-status-banner";
import { PassportIndexerSyncBanner } from "@/components/passport/passport-indexer-sync-banner";
import { PassportIdLabel } from "@/components/passport/passport-id-label";
import { PassportPhotoGallery } from "@/components/passport/passport-photo-gallery";
import { PassportRecordsTimeline } from "@/components/passport/passport-records-timeline";
import { PassportSpecGrid } from "@/components/passport/passport-spec-grid";
import { PassportTrustBanner } from "@/components/passport/passport-trust-banner";
import { PassportUriHistory } from "@/components/passport/passport-uri-history";
import { VerifierInactiveInline } from "@/components/passport/verifier-inactive-badge";
import { WatchlistButton } from "@/components/watchlist/watchlist-button";
import { PassportStatusBadge } from "@/components/ui/passport-status-badge";
import { EnsWalletLink } from "@/components/ui/ens-wallet-link";
import type { PassportMetadata } from "@/lib/passport/fetch-arweave-metadata";
import { formatKarPassportTitle } from "@/lib/passport/passport-token-id";
import { getDisputeBannerText } from "@/lib/passport/record-types";
import { showFixedAfterDisputeBanner } from "@/lib/passport/trust-signals";
import { resolvePassportCustody } from "@/lib/marketplace/passport-custody";
import type { PonderPassportDetail } from "@/lib/types/ponder";
import { explorerAddressUrl } from "@/lib/web3/wallet-account";

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

function formatChainDate(timestampSec: string, locale: string): string {
  const sec = Number.parseInt(timestampSec, 10);
  if (!Number.isFinite(sec) || sec <= 0) return "";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(sec * 1000));
}

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
                className="font-mono text-base text-text-secondary hover:text-accent-warm focus-visible:text-accent-warm hover:underline"
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
                    className="text-accent-warm link-underline"
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
                  <Link href="#passport-actions" className="text-accent-warm link-underline">
                    Go to actions
                  </Link>
                </p>
              </div>

              <div className="rounded-md border border-border-default bg-bg-surface p-4">
                <p className="font-mono text-xs font-medium tracking-[0.18em] uppercase text-text-tertiary">
                  Owners
                </p>
                <p className="mt-1.5 font-sans text-sm font-normal leading-[1.5] text-text-secondary">
                  Add clarification below so verifiers can review your response.{" "}
                  <Link href="#passport-actions" className="text-accent-warm link-underline">
                    Go to actions
                  </Link>
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
  const verifiedDate = formatChainDate(passport.verifiedAt, "en");
  const hasVerifier =
    passport.status === "VERIFIED" &&
    passport.verifier.trim() &&
    passport.verifier !== "0x0000000000000000000000000000000000000000";
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
    />
  );

  const titleBlock = (
    <div className="mt-8 flex flex-col gap-2 lg:flex lg:flex-row lg:items-end lg:justify-between">
      <div className="space-y-3">
        <PassportIdLabel tokenId={tokenId} chainId={chainId} variant="eyebrow" />
        <h1 className="font-display text-fluid-display font-medium tracking-[-0.02em] leading-[1.1] text-text-primary">
          {title}
        </h1>
        <PassportStatusBadge status={passport.status} />
      </div>
      <p className="font-sans text-sm text-text-secondary">
        {custody.isEscrowed ? (
          <>
            Seller{" "}
            <EnsWalletLink
              address={custody.profileAddress}
              href={`/profile/${custody.profileAddress}`}
              className="font-mono text-text-secondary hover:text-accent-warm focus-visible:text-accent-warm hover:underline"
            />
            <span className="mx-1 text-text-tertiary">·</span>
            Held in escrow{" "}
            <EnsWalletLink
              address={custody.custodyAddress ?? passport.owner}
              externalHref={explorerAddressUrl(chainId, custody.custodyAddress ?? passport.owner)}
              className="font-mono text-text-secondary hover:text-accent-warm focus-visible:text-accent-warm hover:underline"
            />
          </>
        ) : (
          <>
            On-chain owner{" "}
            <EnsWalletLink
              address={custody.profileAddress}
              href={`/profile/${custody.profileAddress}`}
              className="font-mono text-text-secondary hover:text-accent-warm focus-visible:text-accent-warm hover:underline"
            />
          </>
        )}
      </p>
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-24 text-text-primary md:px-8 xl:max-w-[80rem]">
      <Link
        href={`/?chain=${chainId}`}
        className="font-sans text-sm text-accent-warm link-underline"
      >
        ← Back to marketplace
      </Link>

      {indexerPending && (
        <div className="mt-8">
          <PassportIndexerSyncBanner tokenId={tokenId} chainId={chainId} />
        </div>
      )}

      {isDisputed && (
        <DisputeStatusSection
          disputeBannerText={disputeBannerText}
          lastDisputer={passport.lastDisputer}
          disputeWithdrawn={disputeWithdrawn}
        />
      )}

      {isDisputed && <div className="mt-8">{gallery}</div>}

      {titleBlock}

      <div className="mt-8 space-y-8 lg:grid lg:grid-cols-[1fr_22rem] lg:items-start lg:gap-12 lg:space-y-0">
        <div className="space-y-6">
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

          <section className="space-y-4 rounded-md border border-border-default bg-bg-surface p-6">
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

          {hasVerifier && (
            <section className="space-y-3 rounded-md border border-border-default bg-bg-surface p-6">
              <p className="font-sans text-sm text-text-secondary">
                Verified by{" "}
                <EnsWalletLink
                  address={passport.verifier}
                  href={`/profile/${passport.verifier}`}
                  className="font-mono text-text-secondary hover:text-accent-warm focus-visible:text-accent-warm hover:underline"
                />
                {verifiedDate && (
                  <>
                    {" "}
                    on <span className="font-mono tabular-nums">{verifiedDate}</span>
                  </>
                )}
                <VerifierInactiveInline chainId={chainId} verifier={passport.verifier} />
              </p>
            </section>
          )}

          <div id="passport-actions" className="scroll-mt-24">
            <PassportActionsPanel
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
          </div>

          <div id="passport-comments" className="scroll-mt-24">
            <NostrCommentsSection tokenId={tokenId} />
          </div>

          <PassportUriHistory entries={passport.uriHistory} chainId={chainId} />
        </div>

        <aside className="space-y-6 lg:sticky lg:top-24">
          <PassportTrustBanner
            verificationResetCount={passport.verificationResetCount}
            hadDispute={passport.hadDispute}
            status={passport.status}
          />
          <PassportChainStatusBanner
            tokenId={tokenId}
            ponderStatus={passport.status}
            chainId={chainId}
          />

          {showG2Banner && (
            <div
              className="rounded-md border border-accent-warm/40 bg-bg-surface p-4"
              role="status"
            >
              <p className="font-sans text-sm text-text-primary">
                Fixed after dispute — awaiting re-verification. Metadata was updated after the last
                dispute or reset.
              </p>
            </div>
          )}

          {passport.duplicateVin && (
            <p className="rounded-md border border-status-error/40 bg-bg-surface p-4 text-sm text-status-error">
              Duplicate VIN warning — another passport shares this VIN in the index.
            </p>
          )}

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
        </aside>
      </div>
    </div>
  );
}
