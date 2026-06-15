"use client";

import { Copy } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";
import type { Address } from "viem";

import { EnsAvatar } from "@/components/ui/ens-avatar";
import { ProfileEditLink } from "@/components/profile/profile-edit-link";
import { useEnsProfile } from "@/hooks/use-ens-profile";
import { categoryIndexToLabel } from "@/lib/kar-pro/kar-pro-metadata";

type Props = {
  wallet: Address;
  profileDisplayName?: string | null;
  profileUsername?: string | null;
  locationLabel?: string | null;
  bio?: string | null;
  socialLinks?: { twitter?: string; website?: string; discord?: string };
  isActiveVerifier?: boolean;
  verifierName?: string | null;
  verifierCategory?: number;
  proShowroomSlug?: string | null;
};

export function ProfileHeaderIdentity({
  wallet,
  profileDisplayName,
  profileUsername,
  locationLabel,
  bio,
  socialLinks,
  isActiveVerifier = false,
  verifierName,
  verifierCategory = 5,
  proShowroomSlug,
}: Props) {
  const { displayName, isLoading } = useEnsProfile(wallet);
  const [copied, setCopied] = useState(false);

  const profileName = profileDisplayName || profileUsername;
  const trimmedVerifierName = verifierName?.trim() ?? "";
  const ensName = displayName?.trim() ?? "";
  const useVerifierName =
    isActiveVerifier &&
    trimmedVerifierName.length > 0 &&
    (isLoading || !ensName || trimmedVerifierName.toLowerCase() !== ensName.toLowerCase());
  const headingName = useVerifierName
    ? trimmedVerifierName
    : profileName || displayName;
  const showEnsLoading = !useVerifierName && !profileName && isLoading;

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(wallet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }, [wallet]);

  return (
    <>
      <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-md border border-border-default bg-bg-surface">
        <EnsAvatar address={wallet} size={112} className="h-full w-full" />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {showEnsLoading ? (
            <span className="inline-block h-4 w-32 animate-pulse rounded-sm bg-bg-surface" />
          ) : (
            <h1 className="text-2xl font-medium tracking-tight">{headingName}</h1>
          )}
        </div>
        <span className="group inline-flex items-center gap-1.5 font-mono text-sm text-text-secondary">
          <span title={wallet}>{displayName}</span>
          <button
            type="button"
            onClick={() => void onCopy()}
            className="rounded-sm opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
            aria-label={copied ? "Copied" : "Copy address"}
          >
            <Copy size={14} strokeWidth={1.5} />
          </button>
        </span>
        {isActiveVerifier && (
          <span className="inline-block font-mono text-xs uppercase tracking-wider border border-accent-warm text-accent-warm rounded-sm px-2 py-1">
            ✓ KarPro · {categoryIndexToLabel(verifierCategory).toUpperCase()}
          </span>
        )}
        {proShowroomSlug && (
          <Link
            href={`/pro/${proShowroomSlug}`}
            className="inline-block font-sans text-sm text-accent-warm hover:underline"
          >
            View Pro Showroom →
          </Link>
        )}
        {locationLabel && <p className="text-sm text-text-secondary">{locationLabel}</p>}
        {bio && <p className="text-sm leading-relaxed text-text-primary">{bio}</p>}
        <div className="flex flex-wrap gap-3 text-sm text-accent-warm">
          {socialLinks?.twitter && (
            <a href={socialLinks.twitter} target="_blank" rel="noreferrer" className="hover:underline">
              Twitter
            </a>
          )}
          {socialLinks?.website && (
            <a href={socialLinks.website} target="_blank" rel="noreferrer" className="hover:underline">
              Website
            </a>
          )}
          {socialLinks?.discord && (
            <span className="text-text-secondary">Discord: {socialLinks.discord}</span>
          )}
        </div>
        <ProfileEditLink wallet={wallet} />
      </div>
    </>
  );
}
