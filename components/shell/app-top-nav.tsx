"use client";

import Link from "next/link";
import { Bell, Inbox, PlusCircle, ShieldCheck } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useAccount } from "wagmi";

import { XmtpUnreadBadge } from "@/components/messaging/xmtp-unread-badge";
import { NotificationsUnreadBadge } from "@/components/notifications/notifications-unread-badge";
import { ChainSelector } from "@/components/shell/chain-selector";
import { KargainLogo } from "@/components/ui/kargain-logo";
import { WalletLoginButton } from "@/components/wallet-login-button";
import { useShowBecomeKarPro } from "@/hooks/use-show-become-karpro";
import { cn } from "@/lib/utils";
import { DEFAULT_CHAIN_ID } from "@/lib/web3/supported-chains";

export function AppTopNav() {
  const path = usePathname();
  const sp = useSearchParams();
  const { isConnected } = useAccount();
  const showBecomeKarPro = useShowBecomeKarPro();
  const isMarketplaceBrowse = path === "/";

  const urlChain = sp.get("chain");
  const parsed = urlChain ? Number.parseInt(urlChain, 10) : NaN;
  const expectedChainId = Number.isFinite(parsed) ? parsed : DEFAULT_CHAIN_ID;

  return (
    <header className="sticky top-0 z-50 border-b border-border-default bg-bg-primary">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-3 px-6 md:px-8 xl:max-w-[80rem]">
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <KargainLogo size={24} />
          <span className="hidden font-display text-base font-medium tracking-[-0.02em] text-text-primary sm:block">
            Kargain
          </span>
        </Link>

        <Link
          href="/verifiers"
          aria-label="Verifiers"
          className={cn(
            "inline-flex md:hidden items-center justify-center h-9 w-9 rounded-sm",
            "transition-colors duration-200 focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
            path === "/verifiers"
              ? "text-text-primary"
              : "text-text-secondary hover:text-text-primary"
          )}
        >
          <ShieldCheck size={20} strokeWidth={1.5} aria-hidden />
        </Link>

        <Link
          href="/verifiers"
          className={cn(
            "hidden shrink-0 font-sans text-sm transition-colors duration-200",
            "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
            "md:inline-flex",
            path === "/verifiers"
              ? "text-text-primary"
              : "text-text-secondary hover:text-text-primary"
          )}
        >
          Verifiers
        </Link>

        <div className="flex-1" aria-hidden />

        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/notifications"
            aria-label="Alerts"
            className="group relative hidden h-9 w-9 items-center justify-center rounded-sm text-text-secondary transition-colors duration-200 hover:bg-bg-surface hover:text-text-primary focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] md:inline-flex"
          >
            <Bell size={20} strokeWidth={1.5} className="transition-colors duration-200" aria-hidden />
            {isConnected ? <NotificationsUnreadBadge className="top-1.5 right-1.5" /> : null}
          </Link>
          {isConnected && (
            <Link
              href="/messages"
              aria-label="Messages"
              className="group relative hidden h-9 w-9 items-center justify-center rounded-sm text-text-secondary transition-colors duration-200 hover:bg-bg-surface hover:text-text-primary focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] md:inline-flex"
            >
              <Inbox size={20} strokeWidth={1.5} className="transition-colors duration-200" aria-hidden />
              <XmtpUnreadBadge className="top-1.5 right-1.5" />
            </Link>
          )}
          {showBecomeKarPro && (
            <Link
              href="/kar-pro"
              className="inline-flex h-9 shrink-0 items-center justify-center rounded-sm bg-transparent px-2 font-sans text-xs font-medium text-text-primary transition-colors duration-200 ease-[cubic-bezier(0.33,1,0.68,1)] hover:bg-bg-surface focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] md:px-4 md:text-sm"
            >
              <span className="md:hidden">KarPro</span>
              <span className="hidden md:inline">Become KarPro</span>
            </Link>
          )}
          {isConnected && (
            <Link
              href="/passport/new"
              className="hidden h-9 items-center justify-center gap-2 rounded-sm border border-border-hover bg-transparent px-4 font-sans text-sm font-medium text-text-primary transition-colors duration-200 ease-[cubic-bezier(0.33,1,0.68,1)] hover:border-accent-warm hover:text-accent-warm focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] md:inline-flex"
            >
              <PlusCircle size={16} strokeWidth={1.5} aria-hidden />
              Create passport
            </Link>
          )}
          <ChainSelector
            syncSearchParam={isMarketplaceBrowse}
            expectedChainId={expectedChainId}
            className="hidden md:flex"
          />
          <WalletLoginButton />
        </div>
      </div>
    </header>
  );
}
