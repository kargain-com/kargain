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
    <>
      <div
        className="h-20 bg-bg-card border-b border-border-default bg-[radial-gradient(circle,var(--color-border-default)_1px,transparent_1px)] bg-[size:24px_24px]"
        aria-hidden
      />

      <div className="px-6 md:px-10 pb-8">
        <div className="-mt-8 mb-4 flex items-end justify-between">
          <div className="rounded-full bg-bg-primary p-[3px]">
            <div className="size-20 shrink-0 overflow-hidden rounded-full border border-border-default">
              <IdentityAvatar address={wallet} fill />
            </div>
          </div>

          {(isOwner || (!isOwner && isConnected) || (isActiveVerifier && !isOwner)) && (
            <div className="flex flex-wrap gap-3 pt-10">
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

        <div className="mb-1 flex flex-wrap items-center gap-2">
          {showEnsSkeleton ? (
            <span
              className="inline-block h-6 w-32 animate-pulse rounded-sm bg-bg-card"
              aria-hidden
            />
          ) : (
            <h1 className="font-display text-xl md:text-2xl font-medium tracking-tight text-text-primary">
              {headingName}
            </h1>
          )}
          {isActiveVerifier && (
            <>
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-warm" aria-hidden />
              <span className="font-mono text-xs uppercase tracking-[0.18em] text-accent-warm">
                KarPro · {categoryIndexToLabel(karProCategory ?? 5)}
              </span>
            </>
          )}
        </div>

        <div className="mb-3 flex items-center gap-2">
          <span className="font-mono text-xs text-text-tertiary" title={wallet}>
            {navShortAddress(wallet)}
          </span>
          <button
            type="button"
            onClick={() => void onCopy()}
            className="inline-flex items-center justify-center rounded-sm focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
            aria-label={copied ? "Copied" : "Copy address"}
          >
            {copied ? (
              <CheckCheck size={14} strokeWidth={1.5} className="text-text-secondary" />
            ) : (
              <Copy size={14} strokeWidth={1.5} className="text-text-secondary" />
            )}
          </button>
          {stakeActiveSince != null && stakeActiveSince > 0 && (
            <>
              <span className="text-text-tertiary" aria-hidden>
                ·
              </span>
              <span className="font-mono text-xs text-text-tertiary">
                Member since {formatMemberSince(stakeActiveSince)}
              </span>
            </>
          )}
        </div>

        {(proSlug || showVerifierLink || showProfileLink) && (
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {proSlug && <CrossLink href={`/pro/${proSlug}`}>View pro showroom</CrossLink>}
            {showVerifierLink && (
              <CrossLink href={`/profile/${wallet}`}>View verifier page</CrossLink>
            )}
            {showProfileLink && <CrossLink href={`/profile/${wallet}`}>View profile</CrossLink>}
          </div>
        )}

        {verificationCount != null && verificationCount > 0 && (
          <div className="mt-1 flex items-baseline gap-6">
            <span>
              <span className="font-display text-lg font-medium tabular-nums text-text-primary">
                {verificationCount}
              </span>
              <span className="ml-1.5 font-mono text-[10px] tracking-wider text-text-tertiary">
                verification{verificationCount === 1 ? "" : "s"}
              </span>
            </span>
          </div>
        )}
      </div>
    </>
  );
}
