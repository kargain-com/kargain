"use client";

import { CheckCheck, ChevronRight, Copy, MessageSquare } from "lucide-react";
import Link from "next/link";
import { useCallback, useState, type ReactNode } from "react";
import { type Address } from "viem";
import { useAccount, useEnsName } from "wagmi";

import { Button } from "@/components/ui/button";
import { EnsAvatar } from "@/components/ui/ens-avatar";
import { ENS_CHAIN_ID, useEnsProfile } from "@/hooks/use-ens-profile";
import { useIsProfileOwner } from "@/hooks/use-is-profile-owner";
import { useNostrProfile } from "@/hooks/use-nostr-profile";
import { categoryIndexToLabel } from "@/lib/kar-pro/kar-pro-metadata";
import { navShortAddress } from "@/lib/web3/wallet-display";

export interface IdentityHeaderProps {
  wallet: Address;
  karProName?: string;
  karProCategory?: number;
  isActiveVerifier?: boolean;
  verificationCount?: number;
  stakeActiveSince?: number;
  proSlug?: string;
  showVerifierLink?: boolean;
  showProfileLink?: boolean;
  showEditButton?: boolean;
}

function addressInitials(wallet: Address): string {
  return wallet.slice(2, 4).toUpperCase();
}

function formatMemberSince(stakeActiveSince: number): string {
  return new Date(stakeActiveSince * 1000).toLocaleDateString("en", {
    month: "long",
    year: "numeric",
  });
}

function CrossLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-sm text-text-secondary transition-colors duration-150 hover:text-text-primary"
    >
      {children}
      <ChevronRight size={12} strokeWidth={1.5} aria-hidden />
    </Link>
  );
}

export function IdentityHeader({
  wallet,
  karProName,
  karProCategory,
  isActiveVerifier = false,
  verificationCount,
  stakeActiveSince,
  proSlug,
  showVerifierLink = false,
  showProfileLink = false,
  showEditButton = true,
}: IdentityHeaderProps) {
  const { isConnected } = useAccount();
  const isOwner = useIsProfileOwner(wallet);
  const { profile: nostrProfile } = useNostrProfile(wallet);
  const { avatarUrl } = useEnsProfile(wallet);
  const { data: ensName, isLoading: ensNameLoading } = useEnsName({
    address: wallet,
    chainId: ENS_CHAIN_ID,
  });
  const [copied, setCopied] = useState(false);

  const trimmedKarProName = karProName?.trim() ?? "";
  const headingName =
    trimmedKarProName || ensName?.trim() || navShortAddress(wallet);
  const showEnsSkeleton = trimmedKarProName.length === 0 && ensNameLoading;

  const nostrPicture = nostrProfile?.picture?.trim();
  const showNostrAvatar = Boolean(nostrPicture);
  const showEnsAvatar = !showNostrAvatar && Boolean(avatarUrl);

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
    <div className="flex flex-col gap-4">
      {/* Zone 1 — Avatar */}
      <div className="size-14 shrink-0 overflow-hidden rounded-full border border-border-default md:size-[4.5rem]">
        {showNostrAvatar && nostrPicture ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={nostrPicture}
            alt=""
            className="h-full w-full rounded-full object-cover"
          />
        ) : showEnsAvatar ? (
          <EnsAvatar address={wallet} fill shape="round" className="h-full w-full rounded-full" />
        ) : (
          <div className="flex h-full w-full items-center justify-center rounded-full bg-bg-card font-mono text-sm uppercase text-text-secondary">
            {addressInitials(wallet)}
          </div>
        )}
      </div>

      {/* Zone 2 — Name */}
      {showEnsSkeleton ? (
        <span
          className="inline-block h-6 w-32 animate-pulse rounded-sm bg-bg-card"
          aria-hidden
        />
      ) : (
        <h1 className="font-display text-fluid-h2 font-medium text-text-primary">{headingName}</h1>
      )}

      {/* Zone 3 — Address row */}
      <div className="inline-flex items-center gap-1">
        <span className="font-mono text-sm text-text-secondary" title={wallet}>
          {navShortAddress(wallet)}
        </span>
        <button
          type="button"
          onClick={() => void onCopy()}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
          aria-label={copied ? "Copied" : "Copy address"}
        >
          {copied ? (
            <CheckCheck size={14} strokeWidth={1.5} className="text-text-secondary" />
          ) : (
            <Copy size={14} strokeWidth={1.5} className="text-text-secondary" />
          )}
        </button>
      </div>

      {/* Zone 4 — KarPro badge row */}
      {isActiveVerifier && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-warm" aria-hidden />
          <span className="font-mono text-xs uppercase tracking-[0.18em] text-accent-warm">
            KarPro · {categoryIndexToLabel(karProCategory ?? 5)}
          </span>
          {verificationCount != null && verificationCount > 0 && (
            <span className="text-sm text-text-secondary">
              · {verificationCount} verification{verificationCount === 1 ? "" : "s"}
            </span>
          )}
        </div>
      )}

      {/* Zone 5 — Stake info */}
      {isOwner && stakeActiveSince != null && stakeActiveSince > 0 && (
        <p className="text-sm text-text-secondary">
          Member since {formatMemberSince(stakeActiveSince)}
        </p>
      )}

      {/* Zone 6 — Links row */}
      {(proSlug || showVerifierLink || showProfileLink) && (
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {proSlug && <CrossLink href={`/pro/${proSlug}`}>View pro showroom</CrossLink>}
          {showVerifierLink && (
            <CrossLink href={`/profile/${wallet}`}>View verifier page</CrossLink>
          )}
          {showProfileLink && <CrossLink href={`/profile/${wallet}`}>View profile</CrossLink>}
        </div>
      )}

      {/* Zone 7 — Action row */}
      {(isOwner || (!isOwner && isConnected) || (isActiveVerifier && !isOwner)) && (
        <div className="mt-2 flex flex-wrap gap-3">
          {isOwner && showEditButton && (
            <Button variant="secondary" size="sm" asChild>
              <Link href="/profile/edit">Edit profile</Link>
            </Button>
          )}
          {!isOwner && isConnected && (
            <Button variant="secondary" size="sm" asChild>
              <Link href="/messages">
                <MessageSquare size={16} strokeWidth={1.5} aria-hidden />
                Message
              </Link>
            </Button>
          )}
          {isActiveVerifier && !isOwner && (
            <Button variant="primary" size="sm" asChild>
              <Link href="/messages">Get verified</Link>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
