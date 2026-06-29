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
import { usePeerMessagingReachability } from "@/hooks/use-peer-messaging-reachability";
import { categoryIndexToLabel } from "@/lib/kar-pro/kar-pro-metadata";
import { navShortAddress } from "@/lib/web3/wallet-display";

const headerActionClassName = "min-h-9 h-9 px-3 py-1.5 text-xs";

export interface IdentityHeaderProps {
  wallet: Address;
  karProName?: string;
  karProCategory?: number;
  isActiveVerifier?: boolean;
  proSlug?: string;
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
  showEditButton = true,
}: IdentityHeaderProps) {
  const { isConnected } = useAccount();
  const isOwner = useIsProfileOwner(wallet);
  const { reachable, isLoading: reachabilityLoading } = usePeerMessagingReachability(
    !isOwner ? wallet : undefined,
  );
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

  const showActions = isOwner || (!isOwner && isConnected);

  return (
    <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
      <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-full border border-border-default">
        <IdentityAvatar address={wallet} fill />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
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

          {showActions && (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              {isOwner && showEditButton && (
                <Button variant="secondary" size="sm" className={headerActionClassName} asChild>
                  <Link href="/profile/edit">Edit profile</Link>
                </Button>
              )}
              {!isOwner && isConnected && reachable && (
                <Button variant="secondary" size="sm" className={headerActionClassName} asChild>
                  <Link href={`/messages?to=${wallet}`}>
                    <MessageSquare size={14} strokeWidth={1.5} aria-hidden />
                    Message
                  </Link>
                </Button>
              )}
              {!isOwner && isConnected && isActiveVerifier && reachable && (
                <Button variant="primary" size="sm" className={headerActionClassName} asChild>
                  <Link href={`/messages?to=${wallet}`}>Request verification</Link>
                </Button>
              )}
              {!isOwner && isConnected && !reachabilityLoading && !reachable && (
                <p className="text-xs text-text-secondary" role="status">
                  Messages not available
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
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
            <span className="inline-block shrink-0 rounded-sm border border-accent-warm px-2 py-1 font-mono text-xs uppercase tracking-wider text-accent-warm">
              KarPro · {categoryIndexToLabel(karProCategory ?? 5)}
            </span>
          )}
        </div>

        {proSlug && (
          <CrossLink href={`/pro/${proSlug}`}>View pro showroom</CrossLink>
        )}
      </div>
    </div>
  );
}
