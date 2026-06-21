"use client";

import { ChevronDown, Search, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { Address } from "viem";

import type { VerifierDirectoryEntry } from "@/app/actions/verifier-directory";
import { EnsAvatar } from "@/components/ui/ens-avatar";
import {
  categoryIndexToLabel,
  KAR_PRO_CATEGORY_OPTIONS,
} from "@/lib/kar-pro/kar-pro-metadata";
import { navShortAddress } from "@/lib/web3/wallet-display";

const CATEGORY_LABELS = KAR_PRO_CATEGORY_OPTIONS.map((o) => o.label);
const CATEGORY_CHIPS = ["All", ...CATEGORY_LABELS] as const;

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
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<"verifications" | "newest">("verifications");

  const filteredVerifiers = useMemo(() => {
    let result = [...verifiers];
    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (v) => v.name.toLowerCase().includes(q) || v.slug.toLowerCase().includes(q),
      );
    }
    if (categoryFilter !== null) {
      result = result.filter((v) => v.category === categoryFilter);
    }
    result.sort((a, b) => {
      if (sortKey === "verifications") {
        return b.verificationCount - a.verificationCount;
      }
      if (a.joinedAt === 0 && b.joinedAt === 0) return 0;
      if (a.joinedAt === 0) return 1;
      if (b.joinedAt === 0) return -1;
      return b.joinedAt - a.joinedAt;
    });
    return result;
  }, [verifiers, search, categoryFilter, sortKey]);

  const hasActiveFilters = search.trim() !== "" || categoryFilter !== null;

  if (verifiers.length === 0) {
    return (
      <p className="py-16 text-center font-sans text-sm text-text-secondary">
        No active verifiers yet.
      </p>
    );
  }

  return (
    <>
      <div className="mb-8 flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search
              size={16}
              strokeWidth={1.5}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary"
              aria-hidden
            />
            <input
              type="search"
              placeholder="Search by name..."
              aria-label="Search verifiers"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full min-h-11 rounded-sm border border-border-default bg-bg-card py-3 pl-9 pr-4 font-sans text-sm text-text-primary transition-colors duration-200 placeholder:text-text-tertiary focus:border-accent-warm focus:bg-bg-surface focus:outline-none focus-visible:shadow-[var(--focus-ring)]"
            />
          </div>
          <div className="relative shrink-0 sm:w-48">
            <select
              aria-label="Sort verifiers"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as typeof sortKey)}
              className="min-h-11 w-full appearance-none rounded-sm border border-border-default bg-bg-card py-3 pl-4 pr-9 font-sans text-sm text-text-primary transition-colors duration-200 focus:border-accent-warm focus:bg-bg-surface focus:outline-none focus-visible:shadow-[var(--focus-ring)]"
            >
              <option value="verifications">Most verified</option>
              <option value="newest">Newest member</option>
            </select>
            <ChevronDown
              size={16}
              strokeWidth={1.5}
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary"
              aria-hidden
            />
          </div>
        </div>

        <div
          role="group"
          aria-label="Filter by category"
          className="flex flex-wrap gap-2"
        >
          {CATEGORY_CHIPS.map((label, chipIndex) => {
            const isAll = chipIndex === 0;
            const isActive = isAll
              ? categoryFilter === null
              : categoryFilter === chipIndex - 1;

            return (
              <button
                key={label}
                type="button"
                aria-pressed={isActive}
                onClick={() => setCategoryFilter(isAll ? null : chipIndex - 1)}
                className={`inline-flex items-center rounded-sm border px-3 py-1.5 font-sans text-xs font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] ${
                  isActive
                    ? "border-border-hover bg-bg-surface text-text-primary"
                    : "border-border-default bg-transparent text-text-secondary hover:border-border-hover hover:text-text-primary"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {hasActiveFilters && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setCategoryFilter(null);
              }}
              className="inline-flex items-center gap-1.5 font-sans text-xs text-text-secondary transition-colors duration-200 hover:text-text-primary focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
            >
              <X size={14} strokeWidth={1.5} aria-hidden />
              Clear filters
            </button>
          </div>
        )}
      </div>

      {filteredVerifiers.length === 0 ? (
        <div className="py-16 text-center">
          <p className="font-sans text-sm text-text-secondary">
            No verifiers match your filters.
          </p>
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setCategoryFilter(null);
            }}
            className="mt-4 font-sans text-sm text-accent-warm underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filteredVerifiers.map((verifier) => (
            <VerifierCard key={verifier.address} verifier={verifier} />
          ))}
        </div>
      )}
    </>
  );
}
