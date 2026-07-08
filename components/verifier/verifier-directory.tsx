"use client";

import { ChevronDown, Search, X } from "lucide-react";
import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";

import type { VerifierDirectoryEntry } from "@/app/actions/verifier-directory";
import { IdentityAvatar } from "@/components/identity/identity-avatar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { categoryLabel, shellControlHover } from "@/lib/design/instrument-classes";
import {
  categoryIndexToLabel,
  KAR_PRO_CATEGORY_OPTIONS,
} from "@/lib/kar-pro/kar-pro-metadata";
import {
  filterVerifiers,
  formatVerifierDirectoryResultCount,
  type VerifierDirectorySortKey,
} from "@/lib/verifier/filter-verifiers";
import { parseWeiString } from "@/lib/web3/parse-wei-string";
import { navShortAddress } from "@/lib/web3/wallet-display";
import { cn } from "@/lib/utils";
import type { NostrProfileData } from "@/lib/nostr/parse-profile-content";
import { useNostrProfiles } from "@/hooks/use-nostr-profiles";

import { VerificationRequestButton } from "./verification-request-button";
import { VerificationPayButton } from "./verification-payment-modal";
import {
  VerificationFeeDisplay,
  VerificationPaymentChips,
} from "./verification-fee-display";

const CATEGORY_LABELS = KAR_PRO_CATEGORY_OPTIONS.map((o) => o.label);
const CATEGORY_CHIPS = ["All", ...CATEGORY_LABELS] as const;

type Props = {
  verifiers: VerifierDirectoryEntry[];
  onSelectAgent?: (entry: VerifierDirectoryEntry) => void;
  layout?: "grid" | "picker";
};

function displayName(name: string, address: `0x${string}`): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : navShortAddress(address);
}

type VerifierCardProps = {
  verifier: VerifierDirectoryEntry;
  profile: NostrProfileData | null;
  onSelectAgent?: (entry: VerifierDirectoryEntry) => void;
  layout?: "grid" | "picker";
};

function VerifierCard({ verifier, profile, onSelectAgent, layout = "grid" }: VerifierCardProps) {
  const name = displayName(verifier.name, verifier.address);
  const isPicker = layout === "picker" && onSelectAgent;

  if (isPicker) {
    return (
      <article className="flex items-center gap-3 rounded-md border border-border-default bg-bg-card p-3 transition-colors duration-200 hover:border-border-hover">
        <IdentityAvatar address={verifier.address} size={40} alt={name} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-sans text-sm font-medium text-text-primary">{name}</p>
          <p className={categoryLabel}>
            {categoryIndexToLabel(verifier.category)}
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="shrink-0"
          onClick={() => onSelectAgent(verifier)}
        >
          Select as agent
        </Button>
      </article>
    );
  }

  const showroomSlug = verifier.slug.trim();
  const showroomHref = showroomSlug
    ? `/pro/${showroomSlug}`
    : `/profile/${verifier.address}`;
  const feeWei = parseWeiString(verifier.verificationFee);

  return (
    <article className="flex flex-col gap-4 rounded-md border border-border-default bg-bg-card p-6 transition-colors duration-200 hover:border-border-hover">
      <div className="flex items-center gap-3">
        <IdentityAvatar address={verifier.address} size={48} alt={name} />
        <div className="min-w-0">
          <p className="truncate font-sans text-sm font-medium text-text-primary">{name}</p>
          <p className={categoryLabel}>
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
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <VerificationFeeDisplay
            feeWei={feeWei}
            primaryClassName="font-mono text-xs text-text-secondary tabular-nums"
          />
          <VerificationPaymentChips profile={profile} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {onSelectAgent ? (
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            onClick={() => onSelectAgent(verifier)}
          >
            Select as agent
          </Button>
        ) : (
          <>
            <Link
              href={showroomHref}
              className={cn(
                "inline-flex min-h-11 items-center justify-center rounded-sm border border-border-hover bg-transparent px-4 py-2 font-sans text-sm font-medium text-text-primary transition-colors duration-200 focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
                shellControlHover,
              )}
            >
              View showroom →
            </Link>
            <VerificationRequestButton
              verifierAddress={verifier.address}
              verifierName={name}
              verificationFee={feeWei}
            />
            <VerificationPayButton
              verifierAddress={verifier.address}
              verifierName={name}
              feeWei={feeWei}
            />
          </>
        )}
      </div>
    </article>
  );
}

export function VerifierDirectory({
  verifiers,
  onSelectAgent,
  layout = "grid",
}: Props) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<VerifierDirectorySortKey>("verifications");
  const [lightningOnly, setLightningOnly] = useState(false);

  const isPicker = layout === "picker";
  const deferredQuery = useDeferredValue(search.trim());
  const activeOnly = Boolean(onSelectAgent);

  const { profiles } = useNostrProfiles(
    isPicker ? [] : verifiers.map((v) => v.address),
    { enabled: !isPicker },
  );

  const totalPoolCount = useMemo(
    () => (activeOnly ? verifiers.filter((v) => v.active) : verifiers).length,
    [verifiers, activeOnly],
  );

  const filteredVerifiers = useMemo(
    () =>
      filterVerifiers(verifiers, {
        query: deferredQuery,
        categoryIndex: categoryFilter,
        sortKey,
        activeOnly,
        lightningOnly,
        profiles,
      }),
    [verifiers, deferredQuery, categoryFilter, sortKey, activeOnly, lightningOnly, profiles],
  );

  const hasActiveFilters =
    search.trim() !== "" || categoryFilter !== null || lightningOnly;

  if (verifiers.length === 0) {
    return (
      <EmptyState
        variant="content"
        level="B"
        className={isPicker ? "py-8 text-center" : "py-16 text-center"}
        title="No active verifiers yet."
      />
    );
  }

  const filterToolbar = (
    <div className={`flex flex-col gap-4 ${isPicker ? "mb-4" : "mb-8"}`}>
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
            placeholder="Search by name, address, or category…"
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
            onChange={(e) => setSortKey(e.target.value as VerifierDirectorySortKey)}
            className="min-h-11 w-full appearance-none rounded-sm border border-border-default bg-bg-card py-3 pl-4 pr-9 font-sans text-sm text-text-primary transition-colors duration-200 focus:border-accent-warm focus:bg-bg-surface focus:outline-none focus-visible:shadow-[var(--focus-ring)]"
          >
            <option value="verifications">Most verified</option>
            <option value="newest">Newest member</option>
            <option value="lowestFee">Lowest fee</option>
          </select>
          <ChevronDown
            size={16}
            strokeWidth={1.5}
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary"
            aria-hidden
          />
        </div>
      </div>

      <div role="group" aria-label="Filter by category" className="flex flex-wrap gap-2">
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

      {!isPicker && (
        <div role="group" aria-label="Payment method filters" className="flex flex-wrap gap-2">
          <button
            type="button"
            aria-pressed={lightningOnly}
            onClick={() => setLightningOnly((prev) => !prev)}
            className={`inline-flex items-center rounded-sm border px-3 py-1.5 font-sans text-xs font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] ${
              lightningOnly
                ? "border-border-hover bg-bg-surface text-text-primary"
                : "border-border-default bg-transparent text-text-secondary hover:border-border-hover hover:text-text-primary"
            }`}
          >
            Accepts Lightning
          </button>
        </div>
      )}

      {hasActiveFilters && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setCategoryFilter(null);
              setLightningOnly(false);
            }}
            className="inline-flex items-center gap-1.5 font-sans text-xs text-text-secondary transition-colors duration-200 hover:text-text-primary focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
          >
            <X size={14} strokeWidth={1.5} aria-hidden />
            Clear filters
          </button>
        </div>
      )}
    </div>
  );

  const emptyFilters = (
    <EmptyState
      variant="content"
      level="B"
      className={isPicker ? "py-8 text-center" : "py-16 text-center"}
      title="No verifiers match your filters."
      action={{
        label: "Clear filters",
        onClick: () => {
          setSearch("");
          setCategoryFilter(null);
          setLightningOnly(false);
        },
      }}
    />
  );

  const cardList = (
    <div className={isPicker ? "flex flex-col gap-2" : "grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"}>
      {filteredVerifiers.map((verifier) => (
        <VerifierCard
          key={verifier.address}
          verifier={verifier}
          profile={profiles.get(verifier.address.toLowerCase()) ?? null}
          onSelectAgent={onSelectAgent}
          layout={layout}
        />
      ))}
    </div>
  );

  const resultsCounter = !isPicker ? (
    <p className="mb-6 font-mono text-xs text-text-secondary tabular-nums">
      {formatVerifierDirectoryResultCount(
        totalPoolCount,
        filteredVerifiers.length,
        hasActiveFilters,
      )}
    </p>
  ) : null;

  return (
    <>
      {filterToolbar}
      {resultsCounter}
      {filteredVerifiers.length === 0 ? emptyFilters : cardList}
    </>
  );
}
