"use client";

import { Copy } from "lucide-react";
import { useCallback, useState } from "react";
import type { Address } from "viem";

import { EnsAvatar } from "@/components/ui/ens-avatar";
import { KarProBadge } from "@/components/ui/kar-pro-badge";
import { ProfileEditLink } from "@/components/profile/profile-edit-link";
import { useEnsProfile } from "@/hooks/use-ens-profile";

type Props = {
  wallet: Address;
  profileDisplayName?: string | null;
  profileUsername?: string | null;
  karProBal?: bigint;
  locationLabel?: string | null;
  bio?: string | null;
  socialLinks?: { twitter?: string; website?: string; discord?: string };
};

export function ProfileHeaderIdentity({
  wallet,
  profileDisplayName,
  profileUsername,
  karProBal = 0n,
  locationLabel,
  bio,
  socialLinks,
}: Props) {
  const { displayName, isLoading } = useEnsProfile(wallet);
  const [copied, setCopied] = useState(false);

  const profileName = profileDisplayName || profileUsername;
  const headingName = profileName || displayName;
  const showEnsLoading = !profileName && isLoading;

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
          {karProBal > 0n && <KarProBadge />}
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
