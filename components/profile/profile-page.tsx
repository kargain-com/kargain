"use client";

import { useActiveAccount, requireEvmSession } from "@/hooks/use-active-account";

import {
  CircleCheckIcon,
  GlobeIcon,
  ShieldCheckIcon,
} from "@/components/ui/icons";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Address } from "viem";

import type {
  KarProVerifierProfile,
} from "@/lib/verifier/verifier-profile-types";
import type { VerifierPublicPassportRow } from "@/lib/verifier/fetch-verifier-public-data";
import { IdentityHeader } from "@/components/identity/identity-header";
import { KarProStatusWidget } from "@/components/profile/karpro-status-widget";
import { ProfileKarProNetworks } from "@/components/profile/profile-kar-pro-networks";
import { ProfileVerifierStatsBand } from "@/components/profile/profile-verifier-stats-band";
import { PassportIdLabel } from "@/components/passport/passport-id-label";
import { ProfileOutstandingTab } from "@/components/profile/profile-outstanding-tab";
import { ProfileActionBanner } from "@/components/profile/profile-action-banner";
import type {
  KarProActiveMembershipFact,
  KarProMembershipRow,
} from "@/lib/kar-pro/membership-roster";
import { AccountSetupBanner } from "@/components/profile/account-setup-banner";
import { CommerceGuardianOpsLink } from "@/components/commerce/commerce-guardian-ops-link";
import { ProfileClaimsTab } from "@/components/claims/profile-claims-tab";
import { ConsignedVehiclesTab } from "@/components/profile/consigned-vehicles-tab";
import { DelegatedVehiclesTab } from "@/components/profile/delegated-vehicles-tab";
import { ProfilePassportCard } from "@/components/profile/profile-passport-card";
import { EmptyState } from "@/components/ui/empty-state";
import { WatchlistClient } from "@/components/watchlist/watchlist-client";
import { useIsProfileOwner } from "@/hooks/use-is-profile-owner";
import { useNostrProfile } from "@/hooks/use-nostr-profile";
import { useOutstandingObligations } from "@/hooks/use-outstanding-obligations";
import { usePendingClaims } from "@/hooks/use-pending-claims";
import {
  ctaLink,
  monoLink,
  profileTabActive,
  profileTabInactive,
  sansLink,
  sansLinkUnderline,
  serialLabel,
} from "@/lib/design/instrument-classes";
import {
  placeSelectionLabel,
} from "@/lib/geo/place-selection";
import { fetchKarProMetadata } from "@/lib/kar-pro/fetch-kar-pro-metadata";
import { LISTING_CARD_GRID_NARROW } from "@/lib/marketplace/listing-card-grid";
import type { NostrProfileData } from "@/lib/nostr/parse-profile-content";
import { mergeProfilePassportWithTransit } from "@/lib/passport/bridge-transit";
import {
  getBridgeTransit,
  getBridgeTransitSnapshot,
  hydrateBridgeTransitFromSession,
  subscribeBridgeTransit,
} from "@/lib/passport/bridge-transit-store";
import { arUriToHttp } from "@/lib/passport/index-passport-metadata";
import type { PonderVerifierAttestation } from "@/lib/types/ponder";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/format/relative-time";
import type {
  ProfileListingRow,
  ProfilePassportRow,
} from "@/lib/passport/map-profile-passport";
import { shortChainName } from "@/lib/web3/supported-chains";
import { navShortAddress } from "@/lib/web3/wallet-display";

export type ProfileOwnedPassport = ProfilePassportRow;

export type ProfileListing = ProfileListingRow;

type TabId =
  | "passports"
  | "listings"
  | "delegated"
  | "saved"
  | "verified"
  | "outstanding"
  | "consigned"
  | "attestations"
  | "claims";

export type ProfilePageProps = {
  wallet: Address;
  chainId: number;
  isActiveVerifier: boolean;
  membershipRows: readonly KarProMembershipRow[];
  activeMembershipFacts: readonly KarProActiveMembershipFact[];
  preferredShowroomChainId: number | null;
  verifierProfile: KarProVerifierProfile | null;
  initialNostrProfile: NostrProfileData | null;
  passports: ProfileOwnedPassport[];
  listings: ProfileListing[];
  verifiedPassports: VerifierPublicPassportRow[];
  attestations: PonderVerifierAttestation[];
  ponderErr: string | null;
  consignedCount?: number | null;
  delegatedCount?: number | null;
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
    delegated: number;
    verified: number;
    attestations: number;
    outstanding: number | null;
    consigned: number;
    claims: number;
  },
): { id: TabId; label: ReactNode }[] {
  const tabs: { id: TabId; label: ReactNode }[] = [
    { id: "passports", label: countLabel("Passports", counts.passports) },
    { id: "listings", label: countLabel("Listings", counts.listings) },
  ];
  if (isOwner) {
    tabs.push({
      id: "claims",
      label: countLabel("Claims", counts.claims),
    });
    tabs.push({
      id: "outstanding",
      label:
        counts.outstanding == null
          ? "Outstanding"
          : countLabel("Outstanding", counts.outstanding),
    });
    tabs.push({
      id: "delegated",
      label: countLabel("Delegated vehicles", counts.delegated),
    });
    tabs.push({ id: "saved", label: "Saved" });
  }
  if (showVerifierHistory) {
    tabs.push({ id: "verified", label: countLabel("Verified", counts.verified) });
    tabs.push({ id: "attestations", label: countLabel("Attestations", counts.attestations) });
  }
  if (isOwner && isActiveVerifier) {
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
  if (raw === "disputes" || raw === "challenges") return "outstanding";
  if (raw && ids.has(raw as TabId)) return raw as TabId;
  return "passports";
}

function profileTabUrl(wallet: Address, tab: TabId): string {
  if (tab === "passports") return `/profile/${wallet}`;
  return `/profile/${wallet}?tab=${tab}`;
}

function tabButtonClass(active: boolean): string {
  return active ? profileTabActive : profileTabInactive;
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

function ProfileBio({
  about,
  website,
  locationLabel,
}: {
  about: string;
  website: string;
  locationLabel: string | null;
}) {
  const href = website ? normalizeWebsiteHref(website) : null;
  const label = website ? formatWebsiteLabel(website) : "";

  if (!about && !href && !locationLabel) return null;

  return (
    <div className="-mt-2 flex flex-col gap-2 sm:pl-[8.5rem]">
      {about && (
        <p className="font-sans text-sm leading-relaxed text-text-secondary">{about}</p>
      )}
      {locationLabel && (
        <p className="font-mono text-sm text-text-secondary">{locationLabel}</p>
      )}
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={cn("inline-flex w-fit items-center gap-1.5", ctaLink)}
        >
          <GlobeIcon size={14} aria-hidden />
          {label}
        </a>
      )}
    </div>
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
    <li className="px-4 py-3">
      <Link
        href={`/marketplace/${attestation.tokenId}?chain=${chainId}`}
        className={cn(monoLink, "text-sm hover:underline")}
      >
        <PassportIdLabel
          tokenId={attestation.tokenId}
          chainId={chainId}
          variant="mono"
          className="text-sm"
        />
      </Link>
      {attestation.description.trim() && (
        <p className="mt-1 truncate text-sm text-text-secondary">
          {attestation.description.trim()}
        </p>
      )}
      {date && (
        <p className="mt-1 font-mono text-xs text-text-tertiary tabular-nums">{date}</p>
      )}
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(sansLink, "mt-1 inline-block text-xs hover:underline")}
        >
          View evidence →
        </a>
      )}
    </li>
  );
}

export function ProfilePage({
  wallet,
  chainId,
  isActiveVerifier,
  membershipRows,
  activeMembershipFacts,
  preferredShowroomChainId,
  verifierProfile,
  initialNostrProfile,
  passports,
  listings,
  verifiedPassports,
  attestations,
  ponderErr,
  consignedCount = null,
  delegatedCount = null,
}: ProfilePageProps) {
  const searchParams = useSearchParams();
  const { account } = useActiveAccount();
  const evm = requireEvmSession(account);
  const address = evm.ok ? evm.address : undefined;
  const isConnected = evm.ok;
  const isOwner = useIsProfileOwner(wallet);
  const { profile } = useNostrProfile(wallet, initialNostrProfile);

  const transitStoreVersion = useSyncExternalStore(
    subscribeBridgeTransit,
    getBridgeTransitSnapshot,
    getBridgeTransitSnapshot,
  );

  useEffect(() => {
    if (!isOwner || !address) return;
    for (const p of passports) {
      hydrateBridgeTransitFromSession(address, p.tokenId);
    }
  }, [address, isOwner, passports]);

  const passportTransitOverlays = useMemo(() => {
    // External-store bump — forces recompute when transit records change.
    void transitStoreVersion;
    if (!isOwner || !address) return new Map<string, { badge: string; hrefChainId: number }>();
    const map = new Map<string, { badge: string; hrefChainId: number }>();
    for (const p of passports) {
      const transit = getBridgeTransit(address, p.tokenId);
      const overlay = mergeProfilePassportWithTransit({
        tokenId: p.tokenId,
        originChainId: p.chainId,
        custodyChain: p.custodyChain,
        transit,
        dstName: transit ? shortChainName(transit.dstChainId) : "",
      });
      if (overlay.inTransit && overlay.badge) {
        map.set(p.tokenId, {
          badge: overlay.badge,
          hrefChainId: overlay.hrefChainId,
        });
      }
    }
    return map;
  }, [address, isOwner, passports, transitStoreVersion]);

  const showVerifierHistory =
    isActiveVerifier ||
    verifiedPassports.length > 0 ||
    attestations.length > 0 ||
    (verifierProfile?.verificationCount ?? 0) > 0;

  const { total: claimsTotal } = usePendingClaims();
  const { count: outstandingTotal } = useOutstandingObligations({
      address: isOwner ? wallet : undefined,
      isActiveVerifier: isOwner ? isActiveVerifier : false,
      enabled: isOwner,
    });

  const tabs = useMemo(
    () =>
      buildTabList(isOwner, isActiveVerifier, showVerifierHistory, {
        passports: passports.length,
        listings: listings.length,
        delegated: delegatedCount ?? 0,
        verified: verifiedPassports.length,
        attestations: attestations.length,
        outstanding: outstandingTotal,
        consigned: consignedCount ?? 0,
        claims: isOwner ? claimsTotal : 0,
      }),
    [
      isOwner,
      isActiveVerifier,
      showVerifierHistory,
      passports.length,
      listings.length,
      delegatedCount,
      verifiedPassports.length,
      attestations.length,
      outstandingTotal,
      consignedCount,
      claimsTotal,
    ],
  );

  const [activeTab, setActiveTab] = useState<TabId>(() =>
    tabFromSearchParams(searchParams, tabs),
  );

  const tabIds = useMemo(() => new Set(tabs.map((t) => t.id)), [tabs]);
  if (!tabIds.has(activeTab) && activeTab !== "passports") {
    setActiveTab("passports");
  }

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
  const nostrLocationLabel = placeSelectionLabel(profile?.location ?? null);
  const karProMetadataURI =
    isActiveVerifier && verifierProfile?.metadataURI
      ? verifierProfile.metadataURI
      : null;
  const [karProLocationFetch, setKarProLocationFetch] = useState<{
    uri: string;
    label: string | null;
  } | null>(null);

  useEffect(() => {
    if (!karProMetadataURI) return;
    let cancelled = false;
    void fetchKarProMetadata(karProMetadataURI).then((meta) => {
      if (cancelled) return;
      setKarProLocationFetch({
        uri: karProMetadataURI,
        label: placeSelectionLabel(meta?.location ?? null),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [karProMetadataURI]);

  const karProLocationLabel =
    karProMetadataURI != null && karProLocationFetch?.uri === karProMetadataURI
      ? karProLocationFetch.label
      : null;
  const locationLabel = isActiveVerifier
    ? (karProLocationLabel ?? nostrLocationLabel)
    : nostrLocationLabel;
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
          proShowroomChainId={preferredShowroomChainId}
          showEditButton={isOwner}
        />

        <ProfileBio about={about} website={website} locationLabel={locationLabel} />

        {isOwner && <AccountSetupBanner />}

        {isOwner && <CommerceGuardianOpsLink />}

        <ProfileKarProNetworks facts={activeMembershipFacts} isOwner={isOwner} />

        <ProfileVerifierStatsBand
          membershipRows={membershipRows}
          isOwner={isOwner}
        />

        <KarProStatusWidget
          isOwner={isOwner}
          isActiveVerifier={isActiveVerifier}
          membershipRows={membershipRows}
        />

        <ProfileActionBanner
          isOwner={isOwner}
          isConnected={isConnected}
          subjectIsKarPro={isActiveVerifier}
          subjectName={subjectName}
          subjectWallet={wallet}
          outstandingCount={outstandingTotal}
          outstandingHref={profileTabUrl(wallet, "outstanding")}
        />

        {ponderErr && (
          <EmptyState
            variant="infrastructure"
            level="B"
            role="alert"
            title="Indexer unavailable"
            description="Start the Ponder indexer to load profile listings."
          >
            <code className="inline-block rounded-sm bg-bg-card px-2 py-1 font-mono text-xs">
              pnpm ponder:dev
            </code>
          </EmptyState>
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
                <EmptyState
                  variant="content"
                  level="B"
                  title="No passports yet"
                  action={
                    isOwner
                      ? { label: "Mint your first passport →", href: "/passport/new" }
                      : undefined
                  }
                />
              ) : (
                <ul className={LISTING_CARD_GRID_NARROW}>
                  {passports.map((p, index) => {
                    const transit = passportTransitOverlays.get(p.tokenId);
                    return (
                      <li key={`${p.tokenId}-${p.custodyChain ?? p.chainId}`} className="min-h-0">
                        <ProfilePassportCard
                          tokenId={p.tokenId}
                          status={p.status}
                          chainId={p.chainId}
                          custodyChain={p.custodyChain}
                          custodyUnresolved={p.custodyUnresolved}
                          make={p.make}
                          model={p.model}
                          year={p.year}
                          vin={p.vin}
                          imageUrl={p.imageUrl}
                          transitBadge={transit?.badge}
                          hrefChainId={transit?.hrefChainId}
                          index={index}
                        />
                      </li>
                    );
                  })}
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
                <EmptyState
                  variant="content"
                  level="B"
                  title="No active listings"
                  action={
                    isOwner ? { label: "List a passport →", href: "/" } : undefined
                  }
                />
              ) : (
                <ul className={LISTING_CARD_GRID_NARROW}>
                  {listings.map((l, index) => (
                    <li key={`${l.tokenId}-${l.custodyChain ?? l.originChainId}`} className="min-h-0">
                      <ProfilePassportCard
                        tokenId={l.tokenId}
                        status={l.passportStatus}
                        chainId={l.originChainId ?? l.custodyChain ?? 0}
                        custodyChain={l.custodyChain}
                        custodyUnresolved={l.custodyUnresolved}
                        make={l.make}
                        model={l.model}
                        year={l.year}
                        vin={l.vin}
                        imageUrl={l.imageUrl}
                        index={index}
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
                <div className="rounded-md border border-border-default p-8 text-center">
                  <EmptyState
                    variant="content"
                    level="B"
                    icon={ShieldCheckIcon}
                    title="No verified passports yet"
                  />
                </div>
              ) : (
                <ul className={LISTING_CARD_GRID_NARROW}>
                  {verifiedPassports.map((p, index) => (
                    <li key={`${p.tokenId}-${p.custodyChain}`} className="min-h-0">
                      <ProfilePassportCard
                        tokenId={p.tokenId}
                        status={p.status}
                        chainId={p.chainId}
                        custodyChain={p.custodyChain}
                        make={p.make}
                        model={p.model}
                        year={p.year}
                        vin={p.vin}
                        imageUrl={p.imageUrl}
                        index={index}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {activeTab === "outstanding" && isOwner && (
            <section
              role="tabpanel"
              id="profile-panel-outstanding"
              aria-labelledby="profile-tab-outstanding"
            >
              <ProfileOutstandingTab
                address={wallet}
                isActiveVerifier={isActiveVerifier}
              />
            </section>
          )}

          {activeTab === "claims" && isOwner && (
            <section
              role="tabpanel"
              id="profile-panel-claims"
              aria-labelledby="profile-tab-claims"
            >
              <ProfileClaimsTab />
            </section>
          )}

          {activeTab === "delegated" && isOwner && (
            <section
              role="tabpanel"
              id="profile-panel-delegated"
              aria-labelledby="profile-tab-delegated"
            >
              <DelegatedVehiclesTab wallet={wallet} chainId={chainId} />
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
              <p className={cn(serialLabel, "mb-4")}>Attestation feed</p>
              {attestations.length === 0 ? (
                <EmptyState
                  variant="content"
                  level="B"
                  className="py-8"
                  title="No attestations yet"
                />
              ) : (
                <ul className="divide-y divide-border-default rounded-md border border-border-default bg-bg-primary/80">
                  {attestations.map((attestation) => (
                    <AttestationRow
                      key={`${attestation.tokenId}-${attestation.timestamp}`}
                      attestation={attestation}
                      chainId={chainId}
                    />
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
