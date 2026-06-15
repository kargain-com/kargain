"use client";

import Link from "next/link";
import { useState } from "react";
import type { Address } from "viem";

import type { VerifierPassportRow } from "@/app/actions/marketplace-listings";
import { ProfileFavoritesSection } from "@/components/profile/profile-favorites-section";
import { PassportStatusBadge } from "@/components/ui/passport-status-badge";
import type { PassportStatus } from "@/lib/types/ponder";
import { cn } from "@/lib/utils";

type OwnedPassport = {
  tokenId: string;
  status: PassportStatus;
  vin?: string | null;
};

type Listing = {
  tokenId: string;
  passportStatus: PassportStatus;
  make?: string;
  model?: string;
};

type TabId = "passports" | "listings" | "saved" | "verified";

type Props = {
  wallet: Address;
  chainId: number;
  passports: OwnedPassport[];
  listings: Listing[];
  verifiedPassports: VerifierPassportRow[];
  isActiveVerifier: boolean;
  verificationCount: number;
  ponderErr: string | null;
};

function tabButtonClass(active: boolean): string {
  return cn(
    "min-h-11 rounded-sm px-4 py-2 font-sans text-sm transition-colors duration-200 focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
    active
      ? "border border-accent-warm text-text-primary"
      : "border border-transparent text-text-secondary hover:text-text-primary",
  );
}

export function ProfileContentTabs({
  wallet,
  chainId,
  passports,
  listings,
  verifiedPassports,
  isActiveVerifier,
  verificationCount,
  ponderErr,
}: Props) {
  const tabs: { id: TabId; label: string }[] = [{ id: "passports", label: "Passports" }];
  if (listings.length > 0) {
    tabs.push({ id: "listings", label: "Listings" });
  }
  tabs.push({ id: "saved", label: "Saved" });
  if (isActiveVerifier) {
    tabs.push({ id: "verified", label: `Verified (${verificationCount})` });
  }

  const [activeTab, setActiveTab] = useState<TabId>("passports");

  return (
    <div>
      <div
        role="tablist"
        aria-label="Profile content"
        className="mb-6 flex flex-wrap gap-2 border-b border-border-default pb-4"
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
            onClick={() => setActiveTab(tab.id)}
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
          <ul className="grid gap-3 sm:grid-cols-2">
            {passports.length === 0 && !ponderErr && (
              <li className="text-sm text-text-secondary">No indexed passports for this wallet.</li>
            )}
            {passports.map((p) => (
              <li key={p.tokenId}>
                <Link
                  href={`/marketplace/${p.tokenId}?chain=${chainId}`}
                  className="block rounded-md border border-border-default bg-bg-surface px-4 py-3 text-sm hover:border-border-hover"
                >
                  <span className="font-mono text-accent-warm">#{p.tokenId}</span>
                  <span className="ml-2">
                    <PassportStatusBadge status={p.status} />
                  </span>
                  {p.vin && <span className="ml-2 text-xs text-text-secondary">{p.vin}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {activeTab === "listings" && listings.length > 0 && (
        <section
          role="tabpanel"
          id="profile-panel-listings"
          aria-labelledby="profile-tab-listings"
        >
          <ul className="grid gap-3 sm:grid-cols-2">
            {listings.map((l) => (
              <li key={l.tokenId}>
                <Link
                  href={`/marketplace/${l.tokenId}?chain=${chainId}`}
                  className="block rounded-md border border-border-default bg-bg-surface px-4 py-3 text-sm hover:border-border-hover"
                >
                  <span className="font-mono text-accent-warm">#{l.tokenId}</span>
                  <span className="ml-2">
                    <PassportStatusBadge status={l.passportStatus} />
                  </span>
                  {l.make && l.model && (
                    <span className="ml-2 text-xs text-text-secondary">
                      {l.make} {l.model}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {activeTab === "saved" && (
        <section
          role="tabpanel"
          id="profile-panel-saved"
          aria-labelledby="profile-tab-saved"
        >
          <ProfileFavoritesSection wallet={wallet} />
        </section>
      )}

      {activeTab === "verified" && isActiveVerifier && (
        <section
          role="tabpanel"
          id="profile-panel-verified"
          aria-labelledby="profile-tab-verified"
        >
          {verifiedPassports.length === 0 ? (
            <p className="text-sm text-text-secondary">No verified passports yet.</p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {verifiedPassports.map((p) => (
                <li key={p.tokenId}>
                  <Link
                    href={`/marketplace/${p.tokenId}?chain=${chainId}`}
                    className="block rounded-md border border-border-default bg-bg-surface px-4 py-3 hover:border-border-hover"
                  >
                    <span className="font-mono text-sm text-accent-warm">#{p.tokenId}</span>
                    <span className="ml-2">
                      <PassportStatusBadge status={p.status} />
                    </span>
                    {p.make && p.model && (
                      <p className="mt-1 font-sans text-sm text-text-primary">
                        {p.year > 0 ? `${p.year} ` : ""}
                        {p.make} {p.model}
                      </p>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
