"use client";

import { CheckCheck, ChevronRight, Copy, MessageSquare } from "lucide-react";
import Link from "next/link";
import { useCallback, useState, type ReactNode } from "react";
import { type Address } from "viem";
import { useAccount, useEnsName } from "wagmi";

import { IdentityAvatar } from "@/components/identity/identity-avatar";
import { Button } from "@/components/ui/button";
import { ENS_CHAIN_ID } from "@/hooks/use-ens-profile";
import { useIsProfileOwner } from "@/hooks/use-is-profile-owner";
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
  proSlug,
  showVerifierLink = false,
  showProfileLink = false,
  showEditButton = true,
}: IdentityHeaderProps) {
  const { isConnected } = useAccount();
  const isOwner = useIsProfileOwner(wallet);
  const { data: ensName, isLoading: ensNameLoading } = useEnsName({
    address: wallet,
    chainId: ENS_CHAIN_ID,
  });
  const [copied, setCopied] = useState(false);

  const trimmedKarProName = karProName?.trim() ?? "";
  const headingName =
    trimmedKarProName || ensName?.trim() || navShortAddress(wallet);
  const showEnsSkeleton = trimmedKarProName.length === 0 && ensNameLoading;

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
    <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
      <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-full border border-border-default">
        <IdentityAvatar address={wallet} fill />
      </div>

      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {showEnsSkeleton ? (
            <span
              className="inline-block h-6 w-32 animate-pulse rounded-sm bg-bg-card"
              aria-hidden
            />
          ) : (
            <h1 className="font-display text-2xl font-medium tracking-tight text-text-primary">
              {headingName}
            </h1>
          )}
        </div>

        <span className="group inline-flex items-center gap-1.5 font-mono text-sm text-text-secondary">
          <span title={wallet}>{navShortAddress(wallet)}</span>
          <button
            type="button"
            onClick={() => void onCopy()}
            className="rounded-sm opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
            aria-label={copied ? "Copied" : "Copy address"}
          >
            {copied ? (
              <CheckCheck size={14} strokeWidth={1.5} />
            ) : (
              <Copy size={14} strokeWidth={1.5} />
            )}
          </button>
        </span>

        {isActiveVerifier && (
          <span className="inline-block rounded-sm border border-accent-warm px-2 py-1 font-mono text-xs uppercase tracking-wider text-accent-warm">
            KarPro · {categoryIndexToLabel(karProCategory ?? 5)}
          </span>
        )}

        {(proSlug || showVerifierLink || showProfileLink) && (
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {proSlug && <CrossLink href={`/pro/${proSlug}`}>View pro showroom</CrossLink>}
            {showVerifierLink && (
              <CrossLink href={`/profile/${wallet}`}>View verifier page</CrossLink>
            )}
            {showProfileLink && <CrossLink href={`/profile/${wallet}`}>View profile</CrossLink>}
          </div>
        )}

        {(isOwner || (!isOwner && isConnected) || (isActiveVerifier && !isOwner)) && (
          <div className="flex flex-wrap gap-3 pt-1">
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
    </div>
  );
}
