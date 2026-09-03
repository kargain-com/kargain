"use client";

import { useActiveAccount, requireEvmSession } from "@/hooks/use-active-account";

import {
  CheckDoubleIcon,
  ChevronRightIcon,
  CopyIcon,
  MessageIcon,
} from "@/components/ui/icons";
import Link from "next/link";
import { useCallback, useState, type ReactNode } from "react";
import { type Address } from "viem";
import { useEnsName } from "wagmi";

import { IdentityAvatar } from "@/components/identity/identity-avatar";
import { Button } from "@/components/ui/button";
import { KarProBadge } from "@/components/ui/kar-pro-badge";
import { ENS_CHAIN_ID } from "@/hooks/use-ens-profile";
import { useIsProfileOwner } from "@/hooks/use-is-profile-owner";
import { usePeerMessagingReachability } from "@/hooks/use-peer-messaging-reachability";
import { categoryIndexToLabel } from "@/lib/kar-pro/kar-pro-metadata";
import { proShowroomHref } from "@/lib/kar-pro/pro-showroom-href";
import { navShortAddress } from "@/lib/web3/wallet-display";

const headerActionClassName = "min-h-9 h-9 px-3 py-1.5 text-xs";

export interface IdentityHeaderProps {
  wallet: Address;
  karProName?: string;
  karProCategory?: number;
  isActiveVerifier?: boolean;
  proSlug?: string;
  /** Membership chain for showroom link — required when proSlug is set. */
  proShowroomChainId?: number | null;
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
      <ChevronRightIcon size={12} aria-hidden />
    </Link>
  );
}

export function IdentityHeader({
  wallet,
  karProName,
  karProCategory,
  isActiveVerifier = false,
  proSlug,
  proShowroomChainId = null,
  showEditButton = true,
}: IdentityHeaderProps) {
  const { account } = useActiveAccount();
  const evm = requireEvmSession(account);
  const isConnected = evm.ok;
  const isOwner = useIsProfileOwner(wallet);
  const { reachable, isLoading: reachabilityLoading, message: reachabilityMessage } =
    usePeerMessagingReachability(!isOwner ? wallet : undefined);
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
                    <MessageIcon size={14} aria-hidden />
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
                  {reachabilityMessage ?? "Messages not available"}
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
                <CheckDoubleIcon size={14} />
              ) : (
                <CopyIcon size={14} />
              )}
            </button>
          </span>

          {isActiveVerifier && (
            <>
              <KarProBadge className="shrink-0" />
              <span className="font-mono text-xs font-medium tracking-[0.18em] uppercase text-text-tertiary">
                {categoryIndexToLabel(karProCategory ?? 5)}
              </span>
            </>
          )}
        </div>

        {proSlug && proShowroomChainId != null && (
          <CrossLink href={proShowroomHref(proSlug, proShowroomChainId)}>
            View pro showroom
          </CrossLink>
        )}
      </div>
    </div>
  );
}
