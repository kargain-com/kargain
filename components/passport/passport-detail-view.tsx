import Link from "next/link";

import { ListingDetailClientIsland } from "@/components/marketplace/listing-detail-client-island";
import { PassportActionsPanel } from "@/components/passport/passport-actions-panel";
import { PassportPhotoGallery } from "@/components/passport/passport-photo-gallery";
import { PassportSpecGrid } from "@/components/passport/passport-spec-grid";
import { PassportUriHistory } from "@/components/passport/passport-uri-history";
import { PassportStatusBadge } from "@/components/ui/passport-status-badge";
import type { getDetailStrings } from "@/lib/i18n/marketplace-detail-locales";
import type { PassportMetadata } from "@/lib/passport/fetch-arweave-metadata";
import type { PonderPassportDetail } from "@/lib/types/ponder";
import { navShortAddress } from "@/lib/web3/wallet-display";

type T = ReturnType<typeof getDetailStrings>;

type Props = {
  tokenId: string;
  chainId: number;
  passport: PonderPassportDetail;
  metadata: PassportMetadata | null;
  metadataError?: boolean;
  labels: T;
  listing?: {
    active: boolean;
    fiatPrice1e8: string;
    fiatCurrency: number;
    seller: `0x${string}`;
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

function buildTitle(metadata: PassportMetadata | null, tokenId: string): string {
  if (metadata?.name?.trim()) return metadata.name.trim();
  if (metadata?.year && metadata.make && metadata.model) {
    return `${metadata.year} ${metadata.make} ${metadata.model}`;
  }
  if (metadata?.make && metadata.model) {
    return `${metadata.make} ${metadata.model}`;
  }
  return `KarPassport #${tokenId}`;
}

function findDiscrepancyReason(
  records: PonderPassportDetail["records"],
): string | null {
  for (const record of records) {
    if (record.recordType === "discrepancy" && record.description.trim()) {
      return record.description.trim();
    }
  }
  return null;
}

export function PassportDetailView({
  tokenId,
  chainId,
  passport,
  metadata,
  metadataError,
  labels: t,
  listing = null,
}: Props) {
  const title = buildTitle(metadata, tokenId);
  const discrepancyReason = findDiscrepancyReason(passport.records);
  const verifiedDate = formatChainDate(passport.verifiedAt, "en");
  const hasVerifier =
    passport.status === "VERIFIED" &&
    passport.verifier.trim() &&
    passport.verifier !== "0x0000000000000000000000000000000000000000";

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-24 text-text-primary md:px-8 xl:max-w-[80rem]">
      <Link
        href={`/?chain=${chainId}`}
        className="font-sans text-sm text-accent-warm link-underline"
      >
        ← {t.backMarketplace}
      </Link>

      <div className="mt-8 space-y-8 lg:grid lg:grid-cols-[1fr_22rem] lg:items-start lg:gap-12 lg:space-y-0">
        <div className="space-y-6">
          <PassportPhotoGallery
            photos={metadata?.photos ?? []}
            labels={{ galleryPrev: t.galleryPrev, galleryNext: t.galleryNext }}
          />

          {metadata?.description && (
            <section className="space-y-2">
              <h2 className="font-display text-fluid-h2 font-medium tracking-[-0.015em] text-text-primary">
                {t.description}
              </h2>
              <p className="font-sans text-base font-normal leading-[1.6] text-text-primary">
                {metadata.description}
              </p>
            </section>
          )}

          <section className="space-y-4 rounded-md border border-border-default bg-bg-surface p-6">
            <h2 className="font-display text-fluid-h2 font-medium tracking-[-0.015em] text-text-primary">
              {t.attributes}
            </h2>
            <PassportSpecGrid metadata={metadata} metadataError={metadataError} />
          </section>

          <section className="space-y-4 rounded-md border border-border-default bg-bg-surface p-6">
            <h2 className="font-display text-fluid-h2 font-medium tracking-[-0.015em] text-text-primary">
              {t.historyRecords}
            </h2>
            {passport.records.length === 0 ? (
              <p className="font-sans text-sm text-text-secondary">{t.noRecordsHint}</p>
            ) : (
              <ul className="space-y-3">
                {passport.records.map((record) => (
                  <li
                    key={record.id}
                    className="rounded-md border border-border-default bg-bg-primary/80 p-4"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-mono text-xs font-medium uppercase tracking-[0.18em] text-text-tertiary">
                        {record.recordType}
                      </p>
                      <p className="font-mono text-xs font-normal tabular-nums text-text-secondary">
                        {formatChainDate(record.timestamp, "en") || t.atTime}
                      </p>
                    </div>
                    <p className="mt-2 font-sans text-sm text-text-secondary">
                      {t.author}:{" "}
                      <Link
                        href={`/profile/${record.author}`}
                        className="font-mono text-accent-warm hover:underline"
                      >
                        {navShortAddress(record.author)}
                      </Link>
                    </p>
                    {record.description.trim() && (
                      <p className="mt-2 font-sans text-sm text-text-primary">
                        {record.description}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <PassportUriHistory entries={passport.uriHistory} />

          <PassportActionsPanel
            tokenId={tokenId}
            chainId={chainId}
            passportOwner={passport.owner as `0x${string}`}
            status={passport.status}
            verifier={passport.verifier}
            lastDisputer={passport.lastDisputer}
            disputeWithdrawnAt={passport.disputeWithdrawnAt}
            duplicateVin={passport.duplicateVin}
            listingActive={listing?.active}
          />
        </div>

        <aside className="space-y-6 lg:sticky lg:top-24">
          <div className="space-y-3">
            <p className="font-mono text-xs font-medium tracking-[0.18em] uppercase text-text-tertiary">
              {t.passport} #{tokenId}
            </p>
            <h1 className="font-display text-fluid-display font-medium tracking-[-0.02em] leading-[1.1] text-text-primary">
              {title}
            </h1>
            <PassportStatusBadge status={passport.status} />
          </div>

          {passport.status === "DISPUTED" && (
            <div
              className="rounded-md border border-status-error/40 bg-bg-surface p-4"
              role="status"
            >
              <p className="font-sans text-sm font-medium text-text-primary">
                {t.discrepancyNoticeTitle}
              </p>
              <p className="mt-2 font-sans text-sm text-text-secondary">
                {passport.disputeReason.trim() || discrepancyReason || t.discrepancyBanner}
              </p>
              {passport.disputeWithdrawnAt !== "0" &&
                Number.parseInt(passport.disputeWithdrawnAt, 10) > 0 && (
                  <p className="mt-2 text-sm text-text-secondary">Dispute withdrawn</p>
                )}
            </div>
          )}

          {passport.duplicateVin && (
            <p className="rounded-md border border-status-error/40 p-3 text-sm text-status-error">
              Duplicate VIN warning — another passport shares this VIN in the index.
            </p>
          )}

          <ListingDetailClientIsland
            chainId={chainId}
            tokenId={tokenId}
            listing={listing}
            passportOwner={passport.owner as `0x${string}`}
            labels={t}
          />

          <section className="space-y-3 rounded-md border border-border-default bg-bg-surface p-6">
            <h2 className="font-sans text-base font-medium text-text-primary">
              {t.onChainOwner}
            </h2>
            <Link
              href={`/profile/${passport.owner}`}
              className="font-mono text-sm text-accent-warm hover:underline"
            >
              {navShortAddress(passport.owner)}
            </Link>

            {hasVerifier && (
              <div className="border-t border-border-default pt-3">
                <p className="font-sans text-sm text-text-secondary">
                  Verified by{" "}
                  <Link
                    href={`/verifier/${passport.verifier}`}
                    className="font-mono text-accent-warm hover:underline"
                  >
                    {navShortAddress(passport.verifier)}
                  </Link>
                  {verifiedDate && <> on {verifiedDate}</>}
                </p>
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
