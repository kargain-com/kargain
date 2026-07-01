import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Clock } from "lucide-react";

import { getProShowroomData } from "@/app/actions/pro-showroom";
import { IdentityAvatar } from "@/components/identity/identity-avatar";
import { ListingCard } from "@/components/marketplace/listing-card";
import { PassportIdLabel } from "@/components/passport/passport-id-label";
import { SellerContactButton } from "@/components/marketplace/seller-contact-button";
import { VerificationPayButton } from "@/components/verifier/verification-payment-modal";
import { PassportStatusBadge } from "@/components/ui/passport-status-badge";
import { categoryIndexToLabel } from "@/lib/kar-pro/kar-pro-metadata";
import { arUriToHttp } from "@/lib/passport/index-passport-metadata";
import { formatPassportTitle } from "@/lib/passport/passport-token-id";
import { formatVerificationFee } from "@/lib/verifier/verification-fee";
import type { PonderVerifierAttestation } from "@/lib/types/ponder";
import { navShortAddress } from "@/lib/web3/wallet-display";
import { DEFAULT_CHAIN_ID } from "@/lib/web3/supported-chains";

const CONTAINER =
  "mx-auto w-full max-w-7xl xl:max-w-[80rem] px-6 md:px-8";

const loadProShowroom = cache(getProShowroomData);

function formatChainDate(timestampSec: string): string {
  const sec = Number.parseInt(timestampSec, 10);
  if (!Number.isFinite(sec) || sec <= 0) return "";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(sec * 1000));
}

function evidenceHref(evidenceCID: string): string | null {
  const trimmed = evidenceCID.trim();
  if (!trimmed) return null;
  return (
    arUriToHttp(trimmed) ??
    (trimmed.startsWith("http") ? trimmed : `https://arweave.net/${trimmed}`)
  );
}

function truncateDescription(text: string, maxLen: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen - 1).trimEnd()}…`;
}

function displayName(
  name: string | undefined,
  address: `0x${string}`,
): string {
  const trimmed = name?.trim() ?? "";
  return trimmed || navShortAddress(address);
}

function AttestationRow({
  attestation,
  chainId,
}: {
  attestation: PonderVerifierAttestation;
  chainId: number;
}) {
  const href = evidenceHref(attestation.evidenceCID);
  const date = formatChainDate(attestation.timestamp);

  return (
    <div className="flex flex-col gap-1">
      <Link
        href={`/marketplace/${attestation.tokenId}?chain=${chainId}`}
        className="font-mono text-sm text-accent-warm hover:underline"
      >
        <PassportIdLabel
          tokenId={attestation.tokenId}
          chainId={chainId}
          className="text-sm text-accent-warm hover:underline"
        />
      </Link>
      {attestation.description.trim() && (
        <p className="line-clamp-2 font-sans text-sm text-text-primary">
          {attestation.description.trim()}
        </p>
      )}
      {date && <p className="font-mono text-xs text-text-secondary">{date}</p>}
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="font-sans text-xs text-accent-warm hover:underline"
        >
          Evidence ↗
        </a>
      )}
    </div>
  );
}

function SectionHeader({
  id,
  title,
}: {
  id: string;
  title: string;
}) {
  return (
    <header className="mb-12 max-w-3xl md:mb-16">
      <h2
        id={id}
        className="font-display text-fluid-display font-medium tracking-[-0.02em] leading-[1.1] text-text-primary"
      >
        {title}
      </h2>
    </header>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await loadProShowroom(slug);
  if (!data) return { title: "Pro showroom" };

  if (!data.isActiveVerifier) {
    return {
      title: `${slug} · Showroom coming soon · Kargain`,
    };
  }

  const name = displayName(data.verifier?.name, data.address);
  const description = data.profileMetadata?.description
    ? truncateDescription(data.profileMetadata.description, 160)
    : `Verified vehicle passports by ${name} on Kargain.`;

  return {
    title: `${name} — KarPro Verifier on Kargain`,
    description,
  };
}

export default async function ProShowroomPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await loadProShowroom(slug);
  if (!data) notFound();

  const { address, verifier, profileMetadata } = data;
  const name = displayName(verifier?.name, address);

  const showShowroom =
    data.isActiveVerifier ||
    verifier?.active === true ||
    data.verifiedPassportTotal > 0;

  if (!showShowroom) {
    return (
      <div className="min-h-dvh bg-bg-primary text-text-primary">
        <section className="w-full bg-bg-primary py-16">
          <div className={CONTAINER}>
            <div className="flex gap-6">
              <IdentityAvatar address={address} size={80} />
              <div className="min-w-0">
                <h1 className="font-display text-fluid-display font-medium tracking-[-0.02em] leading-[1.1] text-text-primary">
                  {name}
                </h1>
              </div>
            </div>
          </div>
        </section>

        <div className="py-24 text-center">
          <Clock
            size={48}
            strokeWidth={1}
            className="mx-auto text-text-tertiary"
            aria-hidden
          />
          <h2 className="mt-4 font-display text-fluid-h2 font-medium">
            {name}&apos;s showroom
          </h2>
          <p className="mx-auto mt-2 max-w-sm font-sans text-sm text-text-secondary">
            This professional showroom will be available once the verifier activates
            their KarPro status.
          </p>
          <Link
            href="/kar-pro"
            className="mt-4 inline-block font-sans text-sm text-accent-warm hover:underline"
          >
            Become a KarPro verifier →
          </Link>
        </div>
      </div>
    );
  }

  const category = verifier?.category ?? 5;
  const verificationCount = verifier?.verificationCount ?? 0;
  const displayedPassports = data.verifiedPassports.slice(0, 12);
  const displayedAttestations = data.recentAttestations.slice(0, 5);
  const chainId = DEFAULT_CHAIN_ID;

  return (
    <div className="min-h-dvh bg-bg-primary text-text-primary">
      {/* Section 1 — Hero / identity */}
      <section className="w-full bg-bg-primary py-16">
        <div className={CONTAINER}>
          <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex gap-6">
              <IdentityAvatar address={address} size={80} />
              <div className="min-w-0 space-y-4">
                <span className="inline-block font-mono text-xs uppercase tracking-wider border border-accent-warm text-accent-warm rounded-sm px-2 py-1">
                  {categoryIndexToLabel(category).toUpperCase()}
                </span>
                <h1 className="font-display text-fluid-display font-medium tracking-[-0.02em] leading-[1.1] text-text-primary">
                  {name}
                </h1>
                {profileMetadata?.description && (
                  <p className="font-sans text-fluid-body-lg font-normal leading-[1.55] text-text-secondary max-w-xl">
                    {profileMetadata.description}
                  </p>
                )}
                {profileMetadata?.website && (
                  <a
                    href={profileMetadata.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block font-sans text-sm text-accent-warm hover:underline"
                  >
                    {profileMetadata.website}
                  </a>
                )}
              </div>
            </div>

            <div className="grid w-full grid-cols-3 gap-px bg-border-default shrink-0 lg:w-auto">
              <div className="flex flex-col gap-2 bg-bg-primary py-4 px-3 sm:py-6 sm:px-6">
                <p className="font-mono text-xl sm:text-2xl md:text-4xl font-normal tabular-nums tracking-tight text-text-primary">
                  {verificationCount}
                </p>
                <p className="font-sans text-xs sm:text-sm font-normal text-text-secondary">
                  Passports verified
                </p>
              </div>
              <div className="flex flex-col gap-2 bg-bg-primary py-4 px-3 sm:py-6 sm:px-6">
                <p className="font-mono text-xl sm:text-2xl md:text-4xl font-normal tabular-nums tracking-tight text-text-primary">
                  {data.activeListings.length}
                </p>
                <p className="font-sans text-xs sm:text-sm font-normal text-text-secondary">
                  Active listings
                </p>
              </div>
              <div className="flex flex-col gap-2 bg-bg-primary py-4 px-3 sm:py-6 sm:px-6">
                <p className="font-mono text-xl sm:text-2xl md:text-4xl font-normal tabular-nums tracking-tight text-text-primary">
                  {data.attestationTotal}
                </p>
                <p className="font-sans text-xs sm:text-sm font-normal text-text-secondary">
                  Attestations
                </p>
              </div>
            </div>
            <p className="mt-4 font-mono text-sm">
              <span className="text-text-secondary">Verification fee </span>
              <span className="text-text-primary">
                {formatVerificationFee(data.verificationFee)}
              </span>
            </p>
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <SellerContactButton peerAddress={address} label="Contact verifier" />
            {data.verificationFee > 0n && (
              <VerificationPayButton
                verifierAddress={address}
                verifierName={name}
                feeWei={data.verificationFee}
                variant="secondary"
                size="sm"
              />
            )}
            <Link
              href={`/profile/${address}`}
              className="font-sans text-sm text-text-secondary transition-colors duration-200 hover:text-text-primary"
            >
              View verification history →
            </Link>
          </div>
        </div>
      </section>

      {/* Section 2 — Verified passports */}
      <section className="py-24" aria-labelledby="verified-passports-heading">
        <div className={CONTAINER}>
          <SectionHeader id="verified-passports-heading" title="Verified passports" />

          {displayedPassports.length === 0 ? (
            <p className="font-sans text-sm text-text-secondary">
              No verified passports yet.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {displayedPassports.map((passport) => {
                  const title =
                    passport.year && passport.make && passport.model
                      ? `${passport.year} ${passport.make} ${passport.model}`
                      : passport.make && passport.model
                        ? `${passport.make} ${passport.model}`
                        : formatPassportTitle(passport.tokenId, chainId);
                  const verifiedDate = formatChainDate(passport.verifiedAt);

                  return (
                    <Link
                      key={passport.tokenId}
                      href={`/marketplace/${passport.tokenId}?chain=${chainId}`}
                      className="block rounded-md border border-border-default bg-bg-card p-6 transition-colors duration-200 hover:border-accent-warm focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] md:p-8"
                    >
                      <div className="flex flex-col gap-3">
                        <p className="font-sans text-base font-medium text-text-primary">
                          {title}
                        </p>
                        <PassportStatusBadge status={passport.status} />
                        {verifiedDate && (
                          <p className="font-mono text-xs text-text-secondary">
                            Verified {verifiedDate}
                          </p>
                        )}
                        <PassportIdLabel
                          tokenId={passport.tokenId}
                          chainId={chainId}
                          variant="mono"
                          className="text-text-tertiary"
                        />
                      </div>
                    </Link>
                  );
                })}
              </div>
              {data.verifiedPassportTotal > 12 && (
                <Link
                  href={`/profile/${address}`}
                  className="mt-8 inline-block font-sans text-sm text-accent-warm hover:underline"
                >
                  View all {data.verifiedPassportTotal} →
                </Link>
              )}
            </>
          )}
        </div>
      </section>

      {/* Section 3 — Active listings */}
      <section className="py-24" aria-labelledby="active-listings-heading">
        <div className={CONTAINER}>
          <SectionHeader id="active-listings-heading" title="Active listings" />

          {data.activeListings.length === 0 ? (
            <p className="font-sans text-sm text-text-secondary">No active listings.</p>
          ) : (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {data.activeListings.map((listing) => (
                <ListingCard key={listing.tokenId} row={listing} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Section 4 — Active consignments */}
      <section className="py-24" aria-labelledby="active-consignments-heading">
        <div className={CONTAINER}>
          <SectionHeader id="active-consignments-heading" title="Active consignments" />

          {data.activeConsignments.length === 0 ? (
            <p className="font-sans text-sm text-text-secondary">No active consignments.</p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {data.activeConsignments.map((listing) => (
                  <ListingCard key={`consign-${listing.tokenId}`} row={listing} />
                ))}
              </div>
              {data.activeConsignmentTotal > data.activeConsignments.length && (
                <Link
                  href={`/profile/${address}?tab=consigned`}
                  className="mt-8 inline-block font-sans text-sm text-accent-warm hover:underline"
                >
                  View all {data.activeConsignmentTotal} consignments →
                </Link>
              )}
            </>
          )}
        </div>
      </section>

      {/* Section 5 — Recent attestations (omit when empty) */}
      {data.recentAttestations.length > 0 && (
        <section className="py-24" aria-labelledby="recent-attestations-heading">
          <div className={CONTAINER}>
            <SectionHeader id="recent-attestations-heading" title="Recent attestations" />

            <div className="flex flex-col gap-4">
              {displayedAttestations.map((attestation) => (
                <AttestationRow
                  key={`${attestation.tokenId}-${attestation.timestamp}`}
                  attestation={attestation}
                  chainId={chainId}
                />
              ))}
            </div>

            {data.attestationTotal > 5 && (
              <Link
                href={`/profile/${address}?tab=attestations`}
                className="mt-8 inline-block font-sans text-sm text-accent-warm hover:underline"
              >
                View all attestations →
              </Link>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
