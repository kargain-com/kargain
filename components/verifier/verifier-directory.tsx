"use client";

import Link from "next/link";
import { useState } from "react";
import type { Address } from "viem";

import type { VerifierDirectoryEntry } from "@/app/actions/verifier-directory";
import { EnsAvatar } from "@/components/ui/ens-avatar";
import { categoryIndexToLabel } from "@/lib/kar-pro/kar-pro-metadata";
import { navShortAddress } from "@/lib/web3/wallet-display";

type Props = {
  verifiers: VerifierDirectoryEntry[];
};

function displayName(name: string, address: `0x${string}`): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : navShortAddress(address);
}

function cardInitials(name: string, address: `0x${string}`): string {
  const trimmed = name.trim();
  if (trimmed.length >= 2) return trimmed.slice(0, 2).toUpperCase();
  return navShortAddress(address).slice(0, 2).toUpperCase();
}

function InitialsAvatar({ initials }: { initials: string }) {
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-border-default bg-bg-card font-mono text-xs text-text-secondary">
      {initials}
    </div>
  );
}

function VerifierCardAvatar({
  address,
  name,
  nostrPicture,
}: {
  address: `0x${string}`;
  name: string;
  nostrPicture: string | null;
}) {
  const [pictureFailed, setPictureFailed] = useState(false);
  const alt = displayName(name, address);
  const initials = cardInitials(name, address);

  if (nostrPicture && !pictureFailed) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src={nostrPicture}
        alt={alt}
        className="h-12 w-12 shrink-0 rounded-full object-cover"
        onError={() => setPictureFailed(true)}
      />
    );
  }

  if (nostrPicture && pictureFailed) {
    return <InitialsAvatar initials={initials} />;
  }

  return <EnsAvatar address={address as Address} size={48} />;
}

function VerifierCard({ verifier }: { verifier: VerifierDirectoryEntry }) {
  const showroomSlug = verifier.slug.trim();
  const showroomHref = showroomSlug
    ? `/pro/${showroomSlug}`
    : `/profile/${verifier.address}`;

  return (
    <article className="flex flex-col gap-4 rounded-md border border-border-default bg-bg-card p-6 transition-colors duration-200 hover:border-border-hover">
      <div className="flex items-center gap-3">
        <VerifierCardAvatar
          address={verifier.address}
          name={verifier.name}
          nostrPicture={verifier.nostrPicture}
        />
        <div className="min-w-0">
          <p className="truncate font-sans text-sm font-medium text-text-primary">
            {displayName(verifier.name, verifier.address)}
          </p>
          <p className="font-mono text-xs font-medium tracking-[0.18em] uppercase text-accent-warm">
            {categoryIndexToLabel(verifier.category)}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-baseline gap-1.5">
          <span className="font-mono text-2xl font-normal tabular-nums text-text-primary">
            {verifier.verificationCount}
          </span>
          <span className="font-sans text-xs text-text-secondary">verifications</span>
        </div>
        {verifier.joinedAt > 0 && (
          <p className="font-sans text-xs text-text-secondary">
            Member since {new Date(verifier.joinedAt * 1000).getFullYear()}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={showroomHref}
          className="inline-flex items-center justify-center min-h-11 px-4 py-2 rounded-sm border border-border-hover bg-transparent text-text-primary font-sans text-sm font-medium transition-colors duration-200 hover:border-accent-warm hover:text-accent-warm focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
        >
          View showroom →
        </Link>
        <button
          type="button"
          disabled
          aria-label="Request verification (coming soon)"
          className="inline-flex items-center justify-center min-h-11 px-4 py-2 rounded-sm bg-transparent text-text-secondary font-sans text-sm font-medium transition-colors duration-200 hover:text-text-primary hover:bg-bg-surface disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
        >
          Request verification
        </button>
      </div>
    </article>
  );
}

export function VerifierDirectory({ verifiers }: Props) {
  if (verifiers.length === 0) {
    return (
      <p className="text-center font-sans text-sm text-text-secondary">
        No active verifiers yet.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {verifiers.map((verifier) => (
        <VerifierCard key={verifier.address} verifier={verifier} />
      ))}
    </div>
  );
}
