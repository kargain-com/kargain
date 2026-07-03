import Link from "next/link";

import { PassportCommentTeaser } from "@/components/passport/passport-comment-teaser";
import { PassportDataStrip } from "@/components/passport/passport-data-strip";
import { PassportDetailPanelChrome } from "@/components/passport/passport-detail-panel-chrome";
import { PassportIndexerSyncBanner } from "@/components/passport/passport-indexer-sync-banner";
import { PassportIdLabel } from "@/components/passport/passport-id-label";
import { PassportPanelLink } from "@/components/passport/passport-panel-link";
import { PassportPhotoGallery } from "@/components/passport/passport-photo-gallery";
import { PassportSpecGrid } from "@/components/passport/passport-spec-grid";
import { PassportChainStatusBanner } from "@/components/passport/passport-chain-status-banner";
import { PassportStatusBadge } from "@/components/ui/passport-status-badge";
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
      "Community review in progress: one or more discrepancy reports were submitted for this passport.",
  });
  const showG2Banner = showFixedAfterDisputeBanner(passport);
  const custody = resolvePassportCustody({
    chainId,
    passportOwner: passport.owner as `0x${string}`,
    listing,
  });
  const statusSublabel = sealSublabel(passport.status, passport.verifier);

  return (
    <div className="mx-auto w-full max-w-7xl px-6 pb-36 pt-8 text-text-primary md:px-8 md:pb-28 md:pt-12 xl:max-w-[80rem]">
      <Link href={`/?chain=${chainId}`} className="font-sans text-sm link-underline">
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
        listing={listing}
        duplicateVin={passport.duplicateVin}
        hadDispute={passport.hadDispute}
        records={passport.records}
        lastDisputer={passport.lastDisputer}
        disputeReason={passport.disputeReason}
        disputeWithdrawnAt={passport.disputeWithdrawnAt}
        tokenUri={passport.tokenUri}
        currentMetadata={metadata}
        uriHistory={passport.uriHistory}
        verificationResetCount={passport.verificationResetCount}
        lastVerificationResetAt={passport.lastVerificationResetAt}
      >
        <div className="mt-8 flex items-start justify-between gap-4">
          <h1 className="min-w-0 max-w-[min(100%,32rem)] font-display text-fluid-display font-medium tracking-[-0.02em] leading-[1.1] text-text-primary">
            {title}
          </h1>
          <PassportStatusBadge
            status={passport.status}
            sublabel={statusSublabel}
            className="shrink-0"
          />
        </div>

        <div className="mt-2">
          <PassportIdLabel tokenId={tokenId} chainId={chainId} variant="eyebrow" />
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
          {showG2Banner && (
            <div
              className="rounded-md border border-accent-warm/40 bg-bg-primary/80 p-4"
              role="status"
            >
              <p className="font-sans text-sm text-text-primary">
                Fixed after dispute — awaiting re-verification. Metadata was updated after the last
                dispute or reset.
              </p>
            </div>
          )}
          {passport.duplicateVin && (
            <p className={cn(elevatedAdvisoryPanel, elevatedAdvisoryText)} role="status">
              Duplicate VIN warning — another passport shares this VIN in the index.
            </p>
          )}
        </div>

        <div className="mt-6">
          <PassportPhotoGallery
            photos={metadata?.photos ?? []}
            chainId={chainId}
            verified={passport.status === "VERIFIED"}
          />
        </div>

        {metadata?.description && (
          <section className="mt-7">
            <p className="max-w-3xl font-sans text-base font-normal leading-[1.7] text-text-primary">
              {metadata.description}
            </p>
          </section>
        )}

        <div className="mt-5">
          <PassportCommentTeaser />
        </div>

        <section className="mt-7 space-y-4">
          <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-text-tertiary">
            Attributes
          </p>
          <PassportSpecGrid metadata={metadata} metadataError={metadataError} />
        </section>
      </PassportDetailPanelChrome>
    </div>
  );
}
