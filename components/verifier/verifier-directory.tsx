"use client";

import { ChevronDownIcon, CloseIcon, SearchIcon } from "@/components/ui/icons";
import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";

import type { VerifierDirectoryEntry } from "@/app/actions/verifier-directory";
import { PlacePicker, type PlacePickerValue } from "@/components/geo/place-picker";
import { IdentityAvatar } from "@/components/identity/identity-avatar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { categoryLabel, shellControlHover } from "@/lib/design/instrument-classes";
import {
  isCompletePlaceSelection,
  parsePlaceSelection,
  type PlaceSelection,
} from "@/lib/geo/place-selection";
import {
  categoryIndexToLabel,
  KAR_PRO_CATEGORY_OPTIONS,
} from "@/lib/kar-pro/kar-pro-metadata";
import { proShowroomHref } from "@/lib/kar-pro/pro-showroom-href";
import {
  filterVerifiers,
  formatVerifierDirectoryResultCount,
  type VerifierDirectorySortKey,
} from "@/lib/verifier/filter-verifiers";
import { COMMERCIAL_ACTIVE } from "@/lib/web3/commercial-active";
import { shortChainName } from "@/lib/web3/supported-chains";
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

const COMMERCIAL_NETWORK_IDS = Object.keys(COMMERCIAL_ACTIVE)
  .map(Number)
  .sort((a, b) => a - b);

type Props = {
  verifiers: VerifierDirectoryEntry[];
  onSelectAgent?: (entry: VerifierDirectoryEntry) => void;
  layout?: "grid" | "picker";
  /** When set (agent picker), only that commercial chain; network chips hidden. */
  lockedChainId?: number;
};

function displayName(name: string, address: `0x${string}`): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : navShortAddress(address);
}

function toPickerValue(selection: PlaceSelection | null): PlacePickerValue | null {
  if (!selection) return null;
  return {
    placeId: selection.placeId,
    countryCode: selection.countryCode,
    label: selection.label,
    city: selection.city,
    ...(selection.region ? { region: selection.region } : {}),
  };
}

function fromPickerValue(value: PlacePickerValue | null): PlaceSelection | null {
  if (!value) return null;
  const parsed = parsePlaceSelection(value);
  return parsed != null && isCompletePlaceSelection(parsed) ? parsed : null;
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
          <p className="font-mono text-xs text-text-tertiary">
            {shortChainName(verifier.chainId)}
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
    ? proShowroomHref(showroomSlug, verifier.chainId)
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
          <p className="font-mono text-xs text-text-tertiary">
            {shortChainName(verifier.chainId)}
          </p>
          {verifier.locationLabel.trim() !== "" && (
            <p className="font-mono text-xs text-text-secondary">
              {verifier.locationLabel.trim()}
            </p>
          )}
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
  lockedChainId,
}: Props) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<number | null>(null);
  const [networkFilter, setNetworkFilter] = useState<number | null>(
    lockedChainId ?? null,
  );
  const [sortKey, setSortKey] = useState<VerifierDirectorySortKey>("verifications");
  const [lightningOnly, setLightningOnly] = useState(false);
  const [preferredPlace, setPreferredPlace] = useState<PlaceSelection | null>(null);

  const isPicker = layout === "picker";
  const networkLocked = lockedChainId != null;
  const effectiveNetworkFilter = networkLocked ? lockedChainId : networkFilter;
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

  const clearFilters = () => {
    setSearch("");
    setCategoryFilter(null);
    if (!networkLocked) setNetworkFilter(null);
    setLightningOnly(false);
    setPreferredPlace(null);
  };

  const filteredVerifiers = useMemo(
    () =>
      filterVerifiers(verifiers, {
        query: deferredQuery,
        categoryIndex: categoryFilter,
        chainId: effectiveNetworkFilter,
        sortKey,
        activeOnly,
        lightningOnly,
        profiles,
        preferredPlaceId: preferredPlace?.placeId ?? "",
        preferredCountryCode: preferredPlace?.countryCode ?? "",
      }),
    [
      verifiers,
      deferredQuery,
      categoryFilter,
      effectiveNetworkFilter,
      sortKey,
      activeOnly,
      lightningOnly,
      profiles,
      preferredPlace,
    ],
  );

  const hasActiveFilters =
    search.trim() !== "" ||
    categoryFilter !== null ||
    (!networkLocked && networkFilter != null) ||
    lightningOnly ||
    preferredPlace != null;

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
          <SearchIcon
            size={16}
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
          <ChevronDownIcon
            size={16}
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

      {!networkLocked && (
        <div role="group" aria-label="Filter by network" className="flex flex-wrap gap-2">
          <button
            type="button"
            aria-pressed={networkFilter === null}
            onClick={() => setNetworkFilter(null)}
            className={`inline-flex items-center rounded-sm border px-3 py-1.5 font-sans text-xs font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] ${
              networkFilter === null
                ? "border-border-hover bg-bg-surface text-text-primary"
                : "border-border-default bg-transparent text-text-secondary hover:border-border-hover hover:text-text-primary"
            }`}
          >
            All networks
          </button>
          {COMMERCIAL_NETWORK_IDS.map((id) => {
            const isActive = networkFilter === id;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={isActive}
                onClick={() => setNetworkFilter(id)}
                className={`inline-flex items-center rounded-sm border px-3 py-1.5 font-sans text-xs font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] ${
                  isActive
                    ? "border-border-hover bg-bg-surface text-text-primary"
                    : "border-border-default bg-transparent text-text-secondary hover:border-border-hover hover:text-text-primary"
                }`}
              >
                {shortChainName(id)}
              </button>
            );
          })}
        </div>
      )}

      {!isPicker && (
        <PlacePicker
          id="verifier-directory-place"
          label="Prefer near"
          value={toPickerValue(preferredPlace)}
          onChange={(next) => setPreferredPlace(fromPickerValue(next))}
        />
      )}

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
            onClick={clearFilters}
            className="inline-flex items-center gap-1.5 font-sans text-xs text-text-secondary transition-colors duration-200 hover:text-text-primary focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
          >
            <CloseIcon size={14} aria-hidden />
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
        onClick: clearFilters,
      }}
    />
  );

  const cardList = (
    <div className={isPicker ? "flex flex-col gap-2" : "grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"}>
      {filteredVerifiers.map((verifier) => (
        <VerifierCard
          key={`${verifier.chainId}-${verifier.address.toLowerCase()}`}
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
