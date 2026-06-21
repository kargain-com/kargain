"use client";

import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import type { Address } from "viem";

import type { KarProVerifierProfile } from "@/app/actions/kar-pro-verifier";
import type { VerifierPassportRow } from "@/app/actions/marketplace-listings";
import { IdentityHeader } from "@/components/identity/identity-header";
import { PassportStatusBadge } from "@/components/ui/passport-status-badge";
import { WatchlistClient } from "@/components/watchlist/watchlist-client";
import { useIsProfileOwner } from "@/hooks/use-is-profile-owner";
import { useNostrProfile } from "@/hooks/use-nostr-profile";
import { arUriToHttp } from "@/lib/passport/index-passport-metadata";
import type { PassportStatus, PonderVerifierAttestation } from "@/lib/types/ponder";
import { cn } from "@/lib/utils";

export type ProfileOwnedPassport = {
  tokenId: string;
  status: PassportStatus;
  vin?: string | null;
};

export type ProfileListing = {
  tokenId: string;
  passportStatus: PassportStatus;
  make?: string;
  model?: string;
};

type TabId = "passports" | "listings" | "saved" | "verified" | "attestations";

export type ProfilePageProps = {
  wallet: Address;
  chainId: number;
  isActiveVerifier: boolean;
  verifierProfile: KarProVerifierProfile | null;
  passports: ProfileOwnedPassport[];
  listings: ProfileListing[];
  verifiedPassports: VerifierPassportRow[];
  attestations: PonderVerifierAttestation[];
  ponderErr: string | null;
};

function buildTabList(isOwner: boolean, isActiveVerifier: boolean): { id: TabId; label: string }[] {
  const tabs: { id: TabId; label: string }[] = [
    { id: "passports", label: "Passports" },
    { id: "listings", label: "Listings" },
  ];
  if (isOwner) {
    tabs.push({ id: "saved", label: "Saved" });
  }
  if (isActiveVerifier) {
    tabs.push({ id: "verified", label: "Verified" });
    tabs.push({ id: "attestations", label: "Attestations" });
  }
  return tabs;
}

function tabFromSearchParams(
  searchParams: URLSearchParams,
  tabs: { id: TabId; label: string }[],
): TabId {
  const raw = searchParams.get("tab");
  const ids = new Set(tabs.map((t) => t.id));
  if (raw && ids.has(raw as TabId)) return raw as TabId;
  return "passports";
}

function tabButtonClass(active: boolean): string {
  return cn(
    "min-h-11 border-b-2 -mb-px px-4 py-3 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
    active
      ? "border-accent-warm text-text-primary"
      : "border-transparent text-text-secondary hover:text-text-primary",
  );
}

function formatAttestationDate(timestampSec: string): string {
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

function PassportProfileCard({
  tokenId,
  status,
  chainId,
  vin,
  make,
  model,
  year,
}: {
  tokenId: string;
  status: PassportStatus;
  chainId: number;
  vin?: string | null;
  make?: string;
  model?: string;
  year?: number;
}) {
  return (
    <Link
      href={`/marketplace/${tokenId}?chain=${chainId}`}
      className="block rounded-md border border-border-default bg-bg-surface px-4 py-3 text-sm transition-colors duration-150 hover:border-border-hover focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
    >
      <span className="font-mono text-text-primary">#{tokenId}</span>
      <span className="ml-2">
        <PassportStatusBadge status={status} />
      </span>
      {vin && <span className="ml-2 text-xs text-text-secondary">{vin}</span>}
      {make && model && (
        <p className="mt-1 font-sans text-sm text-text-primary">
          {year != null && year > 0 ? `${year} ` : ""}
          {make} {model}
        </p>
      )}
    </Link>
  );
}

function AttestationRow({
  attestation,
  chainId,
}: {
  attestation: PonderVerifierAttestation;
  chainId: number;
}) {
  const href = evidenceHref(attestation.evidenceCID);
  const date = formatAttestationDate(attestation.timestamp);

  return (
    <div className="border-b border-border-default py-4">
      <Link
        href={`/marketplace/${attestation.tokenId}?chain=${chainId}`}
        className="text-sm text-text-primary transition-colors duration-150 hover:text-accent-warm focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
      >
        Passport #{attestation.tokenId}
      </Link>
      {attestation.description.trim() && (
        <p className="mt-1 truncate text-sm text-text-secondary">
          {attestation.description.trim()}
        </p>
      )}
      {date && <p className="mt-1 text-xs text-text-tertiary">{date}</p>}
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-block text-xs text-accent-warm transition-colors duration-150 hover:text-text-primary focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
        >
          View evidence →
        </a>
      )}
    </div>
  );
}

export function ProfilePage({
  wallet,
  chainId,
  isActiveVerifier,
  verifierProfile,
  passports,
  listings,
  verifiedPassports,
  attestations,
  ponderErr,
}: ProfilePageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isOwner = useIsProfileOwner(wallet);
  const { profile } = useNostrProfile(wallet);

  const tabs = useMemo(
    () => buildTabList(isOwner, isActiveVerifier),
    [isOwner, isActiveVerifier],
  );
  const activeTab = tabFromSearchParams(searchParams, tabs);

  const setTab = useCallback(
    (tab: TabId) => {
      const params = new URLSearchParams(searchParams.toString());
      if (tab === "passports") {
        params.delete("tab");
      } else {
        params.set("tab", tab);
      }
      const query = params.toString();
      router.replace(query ? `/profile/${wallet}?${query}` : `/profile/${wallet}`);
    },
    [router, searchParams, wallet],
  );

  const about = profile?.about?.trim() ?? "";
  const memberSinceYear =
    verifierProfile?.joinedAt != null && verifierProfile.joinedAt > 0
      ? new Date(verifierProfile.joinedAt * 1000).toLocaleDateString("en", {
          year: "numeric",
        })
      : null;

  return (
    <div className="mx-auto max-w-2xl px-6 py-16 text-text-primary">
      <div className="flex flex-col gap-8">
        <IdentityHeader
          wallet={wallet}
          karProName={verifierProfile?.name}
          karProCategory={verifierProfile?.category}
          isActiveVerifier={isActiveVerifier}
          verificationCount={verifierProfile?.verificationCount}
          stakeActiveSince={verifierProfile?.joinedAt}
          proSlug={verifierProfile?.slug}
          showVerifierLink={false}
          showProfileLink={false}
          showEditButton={isOwner}
        />

        {about.length > 0 && (
          <p className="text-base leading-relaxed text-text-secondary">{about}</p>
        )}

        {isActiveVerifier && (
          <div className="flex flex-wrap gap-8 border-y border-border-default py-6">
            <div>
              <p className="font-mono text-fluid-h2 font-medium tabular-nums text-text-primary">
                {verifierProfile?.verificationCount ?? 0}
              </p>
              <p className="mt-1 text-xs text-text-secondary">verifications</p>
            </div>
            {memberSinceYear && (
              <div>
                <p className="font-mono text-fluid-h2 font-medium tabular-nums text-text-primary">
                  {memberSinceYear}
                </p>
                <p className="mt-1 text-xs text-text-secondary">member since</p>
              </div>
            )}
          </div>
        )}

        {ponderErr && (
          <div className="rounded-sm border border-border-default bg-bg-surface p-4 text-sm text-text-secondary">
            <p className="font-medium text-text-primary">Indexer unavailable</p>
            <p className="mt-1">Start the Ponder indexer to load profile listings.</p>
            <code className="mt-2 inline-block rounded-sm bg-bg-card px-2 py-1 font-mono text-xs">
              pnpm ponder:dev
            </code>
          </div>
        )}

        <div>
          <div
            role="tablist"
            aria-label="Profile content"
            className="mb-6 flex flex-wrap border-b border-border-default"
          >
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`profile-tab-${tab.id}`}
                aria-selected={activeTab === tab.id}
                aria-controls={`profile-panel-${tab.id}`}
                className={tabButtonClass(activeTab === tab.id)}
                onClick={() => setTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === "passports" && (
            <section
              role="tabpanel"
              id="profile-panel-passports"
              aria-labelledby="profile-tab-passports"
            >
              {passports.length === 0 && !ponderErr ? (
                <div className="space-y-3">
                  <p className="text-sm text-text-secondary">No passports yet</p>
                  {isOwner && (
                    <Link
                      href="/passport/new"
                      className="inline-flex min-h-11 items-center text-sm text-accent-warm transition-colors duration-150 hover:text-text-primary focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
                    >
                      Mint your first passport →
                    </Link>
                  )}
                </div>
              ) : (
                <ul className="grid gap-3 sm:grid-cols-2">
                  {passports.map((p) => (
                    <li key={p.tokenId}>
                      <PassportProfileCard
                        tokenId={p.tokenId}
                        status={p.status}
                        chainId={chainId}
                        vin={p.vin}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {activeTab === "listings" && (
            <section
              role="tabpanel"
              id="profile-panel-listings"
              aria-labelledby="profile-tab-listings"
            >
              {listings.length === 0 && !ponderErr ? (
                <div className="space-y-3">
                  <p className="text-sm text-text-secondary">No active listings</p>
                  {isOwner && (
                    <Link
                      href="/"
                      className="inline-flex min-h-11 items-center text-sm text-accent-warm transition-colors duration-150 hover:text-text-primary focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
                    >
                      List a passport →
                    </Link>
                  )}
                </div>
              ) : (
                <ul className="grid gap-3 sm:grid-cols-2">
                  {listings.map((l) => (
                    <li key={l.tokenId}>
                      <PassportProfileCard
                        tokenId={l.tokenId}
                        status={l.passportStatus}
                        chainId={chainId}
                        make={l.make}
                        model={l.model}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {activeTab === "saved" && isOwner && (
            <section
              role="tabpanel"
              id="profile-panel-saved"
              aria-labelledby="profile-tab-saved"
            >
              <WatchlistClient />
            </section>
          )}

          {activeTab === "verified" && isActiveVerifier && (
            <section
              role="tabpanel"
              id="profile-panel-verified"
              aria-labelledby="profile-tab-verified"
            >
              {verifiedPassports.length === 0 ? (
                <div className="rounded-sm border border-border-default p-8 text-center">
                  <ShieldCheck
                    size={32}
                    strokeWidth={1.5}
                    className="mx-auto mb-3 text-text-tertiary"
                    aria-hidden
                  />
                  <p className="text-sm text-text-secondary">No verified passports yet</p>
                </div>
              ) : (
                <ul className="grid gap-3 sm:grid-cols-2">
                  {verifiedPassports.map((p) => (
                    <li key={p.tokenId}>
                      <PassportProfileCard
                        tokenId={p.tokenId}
                        status={p.status}
                        chainId={chainId}
                        make={p.make}
                        model={p.model}
                        year={p.year}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {activeTab === "attestations" && isActiveVerifier && (
            <section
              role="tabpanel"
              id="profile-panel-attestations"
              aria-labelledby="profile-tab-attestations"
            >
              {attestations.length === 0 ? (
                <p className="py-8 text-sm text-text-secondary">No attestations yet</p>
              ) : (
                <div>
                  {attestations.map((attestation) => (
                    <AttestationRow
                      key={`${attestation.tokenId}-${attestation.timestamp}`}
                      attestation={attestation}
                      chainId={chainId}
                    />
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
