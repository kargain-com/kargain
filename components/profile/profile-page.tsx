"use client";

import { AlertTriangle, ArrowRight, CheckCircle, Globe, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Address } from "viem";
import { useAccount } from "wagmi";
import type { DisputedPassportRow, KarProVerifierProfile } from "@/app/actions/kar-pro-verifier";
import type { VerifierPassportRow } from "@/app/actions/marketplace-listings";
import { IdentityHeader } from "@/components/identity/identity-header";
import { KarProStatusWidget } from "@/components/profile/karpro-status-widget";
import { ProfileVerifierStatsBand } from "@/components/profile/profile-verifier-stats-band";
import { PassportIdLabel } from "@/components/passport/passport-id-label";
import { ProfileActionBanner } from "@/components/profile/profile-action-banner";
import { AccountSetupBanner } from "@/components/profile/account-setup-banner";
import { MessagingDriftBanner } from "@/components/messaging/messaging-drift-banner";
import { ConsignedVehiclesTab } from "@/components/profile/consigned-vehicles-tab";
import { PassportStatusBadge } from "@/components/ui/passport-status-badge";
import { WatchlistClient } from "@/components/watchlist/watchlist-client";
import { useIsProfileOwner } from "@/hooks/use-is-profile-owner";
import { useNostrProfile } from "@/hooks/use-nostr-profile";
import type { NostrProfileData } from "@/lib/nostr/parse-profile-content";
import { arUriToHttp } from "@/lib/passport/index-passport-metadata";
import type { PassportStatus, PonderVerifierAttestation } from "@/lib/types/ponder";
import { cn } from "@/lib/utils";
import { navShortAddress, shortAddress } from "@/lib/web3/wallet-display";

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

type TabId = "passports" | "listings" | "saved" | "verified" | "disputes" | "consigned" | "attestations";

export type ProfilePageProps = {
  wallet: Address;
  chainId: number;
  isActiveVerifier: boolean;
  verifierProfile: KarProVerifierProfile | null;
  initialNostrProfile: NostrProfileData | null;
  passports: ProfileOwnedPassport[];
  listings: ProfileListing[];
  verifiedPassports: VerifierPassportRow[];
  disputedPassports: DisputedPassportRow[];
  attestations: PonderVerifierAttestation[];
  ponderErr: string | null;
  consignedCount?: number | null;
};

function countLabel(base: string, count: number): ReactNode {
  if (count === 0) return base;
  return (
    <>
      {base}{" "}
      <span className="font-mono text-xs text-text-tertiary">({count})</span>
    </>
  );
}

function buildTabList(
  isOwner: boolean,
  isActiveVerifier: boolean,
  showVerifierHistory: boolean,
  counts: {
    passports: number;
    listings: number;
    verified: number;
    attestations: number;
    disputes: number;
    consigned: number;
  },
): { id: TabId; label: ReactNode }[] {
  const tabs: { id: TabId; label: ReactNode }[] = [
    { id: "passports", label: countLabel("Passports", counts.passports) },
    { id: "listings", label: countLabel("Listings", counts.listings) },
  ];
  if (isOwner) {
    tabs.push({ id: "saved", label: "Saved" });
  }
  if (showVerifierHistory) {
    tabs.push({ id: "verified", label: countLabel("Verified", counts.verified) });
    tabs.push({ id: "attestations", label: countLabel("Attestations", counts.attestations) });
  }
  if (isOwner && isActiveVerifier) {
    tabs.push({ id: "disputes", label: countLabel("Disputes", counts.disputes) });
    tabs.push({
      id: "consigned",
      label: countLabel("Consigned vehicles", counts.consigned),
    });
  }
  return tabs;
}

function tabFromSearchParams(
  searchParams: URLSearchParams,
  tabs: { id: TabId; label: ReactNode }[],
): TabId {
  const raw = searchParams.get("tab");
  const ids = new Set(tabs.map((t) => t.id));
  if (raw && ids.has(raw as TabId)) return raw as TabId;
  return "passports";
}

function profileTabUrl(wallet: Address, tab: TabId): string {
  if (tab === "passports") return `/profile/${wallet}`;
  return `/profile/${wallet}?tab=${tab}`;
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

function normalizeWebsiteHref(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function formatWebsiteLabel(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return new URL(withProtocol).hostname.replace(/^www\./, "");
  } catch {
    return trimmed.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  }
}

function ProfileBio({ about, website }: { about: string; website: string }) {
  const href = website ? normalizeWebsiteHref(website) : null;
  const label = website ? formatWebsiteLabel(website) : "";

  if (!about && !href) return null;

  return (
    <div className="-mt-2 flex flex-col gap-2 sm:pl-[8.5rem]">
      {about && (
        <p className="font-sans text-sm leading-relaxed text-text-secondary">{about}</p>
      )}
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-fit items-center gap-1.5 text-sm text-accent-warm transition-colors duration-150 hover:text-text-primary focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
        >
          <Globe size={14} strokeWidth={1.5} aria-hidden />
          {label}
        </a>
      )}
    </div>
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
      <PassportIdLabel
        tokenId={tokenId}
        chainId={chainId}
        prefix="none"
        variant="mono"
        className="text-text-primary"
      />
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
        <PassportIdLabel
          tokenId={attestation.tokenId}
          chainId={chainId}
          className="text-sm text-accent-warm hover:underline"
        />
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

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function formatVehicleLabel(year: number, make: string, model: string): string {
  const parts: string[] = [];
  if (year > 0) parts.push(String(year));
  const makeTrimmed = make.trim();
  const modelTrimmed = model.trim();
  if (makeTrimmed) parts.push(makeTrimmed);
  if (modelTrimmed) parts.push(modelTrimmed);
  return parts.join(" ");
}

function formatRelativeDisputeTime(timestampSec: number): string {
  if (!Number.isFinite(timestampSec) || timestampSec <= 0) return "";

  const date = new Date(timestampSec * 1000);
  const now = Date.now();
  const diffMs = now - date.getTime();
  if (diffMs < 0) return "just now";

  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(date);
}

function isNonemptyDisputer(address: string): boolean {
  const trimmed = address.trim();
  return trimmed.length > 0 && trimmed.toLowerCase() !== ZERO_ADDRESS;
}

function DisputeCard({
  dispute,
  chainId,
}: {
  dispute: DisputedPassportRow;
  chainId: number;
}) {
  const vehicleLabel = formatVehicleLabel(dispute.year, dispute.make, dispute.model);
  const reason = dispute.disputeReason.trim();
  const openedLabel = formatRelativeDisputeTime(dispute.disputeOpenedAt);
  const showDisputer = isNonemptyDisputer(dispute.lastDisputer);

  return (
    <div className="space-y-3 rounded-sm border border-border-default p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <AlertTriangle
            size={16}
            strokeWidth={1.5}
            className="shrink-0 text-status-warning"
            aria-hidden
          />
          <PassportStatusBadge status="DISPUTED" />
        </div>
        <PassportIdLabel
          tokenId={dispute.tokenId}
          chainId={chainId}
          prefix="none"
          variant="mono"
          className="text-text-tertiary"
        />
      </div>

      {vehicleLabel && (
        <p className="font-sans text-sm text-text-primary">{vehicleLabel}</p>
      )}

      {reason && (
        <p className="line-clamp-2 font-sans text-sm text-text-secondary">
          &ldquo;{reason}&rdquo;
        </p>
      )}

      {(openedLabel || showDisputer) && (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {openedLabel && (
            <span className="font-mono text-xs text-text-tertiary">{openedLabel}</span>
          )}
          {showDisputer && (
            <span className="font-mono text-xs text-text-secondary">
              Disputed by {shortAddress(dispute.lastDisputer)}
            </span>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 border-t border-border-default pt-1">
        <Link
          href={`/marketplace/${dispute.tokenId}?chain=${chainId}`}
          className="ml-auto inline-flex items-center gap-1 font-sans text-sm text-text-secondary transition-colors hover:text-text-primary"
        >
          Resolve
          <ArrowRight size={14} strokeWidth={1.5} aria-hidden />
        </Link>
      </div>
    </div>
  );
}

export function ProfilePage({
  wallet,
  chainId,
  isActiveVerifier,
  verifierProfile,
  initialNostrProfile,
  passports,
  listings,
  verifiedPassports,
  disputedPassports,
  attestations,
  ponderErr,
  consignedCount = null,
}: ProfilePageProps) {
  const searchParams = useSearchParams();
  const { isConnected } = useAccount();
  const isOwner = useIsProfileOwner(wallet);
  const { profile } = useNostrProfile(wallet, initialNostrProfile);

  const showVerifierHistory =
    isActiveVerifier ||
    verifiedPassports.length > 0 ||
    attestations.length > 0 ||
    (verifierProfile?.verificationCount ?? 0) > 0;

  const tabs = useMemo(
    () =>
      buildTabList(isOwner, isActiveVerifier, showVerifierHistory, {
        passports: passports.length,
        listings: listings.length,
        verified: verifiedPassports.length,
        attestations: attestations.length,
        disputes: disputedPassports.length,
        consigned: consignedCount ?? 0,
      }),
    [
      isOwner,
      isActiveVerifier,
      showVerifierHistory,
      passports.length,
      listings.length,
      verifiedPassports.length,
      attestations.length,
      disputedPassports.length,
      consignedCount,
    ],
  );

  const [activeTab, setActiveTab] = useState<TabId>(() =>
    tabFromSearchParams(searchParams, tabs),
  );

  useEffect(() => {
    const ids = new Set(tabs.map((t) => t.id));
    if (!ids.has(activeTab)) {
      setActiveTab("passports");
    }
  }, [tabs, activeTab]);

  useEffect(() => {
    const onPopState = () => {
      setActiveTab(
        tabFromSearchParams(new URLSearchParams(window.location.search), tabs),
      );
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [tabs]);

  const setTab = useCallback(
    (tab: TabId) => {
      setActiveTab(tab);
      window.history.replaceState(null, "", profileTabUrl(wallet, tab));
    },
    [wallet],
  );

  const about = profile?.about?.trim() ?? "";
  const website = profile?.website?.trim() ?? "";
  const subjectName = verifierProfile?.name?.trim() || navShortAddress(wallet);
  return (
    <div className="mx-auto max-w-2xl px-6 py-16 text-text-primary">
      <div className="flex flex-col gap-8">
        <IdentityHeader
          wallet={wallet}
          karProName={verifierProfile?.name}
          karProCategory={verifierProfile?.category}
          isActiveVerifier={isActiveVerifier}
          proSlug={verifierProfile?.slug}
          showEditButton={isOwner}
        />

        <ProfileBio about={about} website={website} />

        {isOwner && <AccountSetupBanner />}
        {isOwner && <MessagingDriftBanner />}

        <ProfileVerifierStatsBand
          wallet={wallet}
          isActiveVerifier={isActiveVerifier}
          initialProfile={verifierProfile}
          isOwner={isOwner}
        />

        <KarProStatusWidget
          isOwner={isOwner}
          isActiveVerifier={isActiveVerifier}
          joinedAt={verifierProfile?.joinedAt ?? 0}
        />

        <ProfileActionBanner
          isOwner={isOwner}
          isConnected={isConnected}
          subjectIsKarPro={isActiveVerifier}
          subjectName={subjectName}
          subjectWallet={wallet}
          openDisputeCount={disputedPassports.length}
          onTabChange={(tab) => setTab(tab as TabId)}
        />

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
              <WatchlistClient layout="narrow" />
            </section>
          )}

          {activeTab === "verified" && showVerifierHistory && (
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

          {activeTab === "disputes" && isOwner && isActiveVerifier && (
            <section
              role="tabpanel"
              id="profile-panel-disputes"
              aria-labelledby="profile-tab-disputes"
            >
              {disputedPassports.length === 0 ? (
                <div className="py-8 text-center">
                  <CheckCircle
                    size={32}
                    strokeWidth={1.5}
                    className="mx-auto mb-3 text-text-tertiary"
                    aria-hidden
                  />
                  <p className="text-sm text-text-secondary">No open disputes</p>
                </div>
              ) : (
                <div className="grid gap-3">
                  {disputedPassports.map((p) => (
                    <DisputeCard key={p.tokenId} dispute={p} chainId={chainId} />
                  ))}
                </div>
              )}
            </section>
          )}

          {activeTab === "consigned" && isOwner && isActiveVerifier && (
            <section
              role="tabpanel"
              id="profile-panel-consigned"
              aria-labelledby="profile-tab-consigned"
            >
              <ConsignedVehiclesTab wallet={wallet} chainId={chainId} />
            </section>
          )}

          {activeTab === "attestations" && showVerifierHistory && (
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
