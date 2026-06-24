"use client";

import Link from "next/link";
import { Bell, Inbox, PlusCircle, ShieldCheck } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useAccount } from "wagmi";

import { XmtpUnreadBadge } from "@/components/messaging/xmtp-unread-badge";
import { NotificationsUnreadBadge } from "@/components/notifications/notifications-unread-badge";
import { ChainSelector } from "@/components/shell/chain-selector";
import { CurrencySelector } from "@/components/shell/currency-selector";
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

        <div className="flex-1" aria-hidden />

        <div className="flex shrink-0 items-center gap-2">
          <CurrencySelector />
          <Link
            href="/verifiers"
            aria-label="Verifiers"
            className={cn(
              "inline-flex shrink-0 items-center justify-center gap-2 rounded-sm border min-h-9",
              "font-sans text-sm font-medium transition-colors duration-200 ease-[cubic-bezier(0.33,1,0.68,1)]",
              "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
              "h-9 w-9 md:w-auto md:px-4",
              path === "/verifiers"
                ? "border-accent-warm bg-bg-surface text-accent-warm"
                : "border-border-hover bg-transparent text-text-primary hover:border-accent-warm hover:text-accent-warm",
            )}
          >
            <ShieldCheck size={20} strokeWidth={1.5} className="shrink-0 md:hidden" aria-hidden />
            <ShieldCheck size={16} strokeWidth={1.5} className="hidden shrink-0 md:block" aria-hidden />
            <span className="hidden md:inline">Verifiers</span>
          </Link>
          {isConnected && (
            <Link
              href="/notifications"
              aria-label="Alerts"
              className="group relative hidden h-9 w-9 items-center justify-center rounded-sm text-text-secondary transition-colors duration-200 hover:bg-bg-surface hover:text-text-primary focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] md:inline-flex"
            >
              <Bell size={20} strokeWidth={1.5} className="transition-colors duration-200" aria-hidden />
              <NotificationsUnreadBadge className="top-1.5 right-1.5" />
            </Link>
          )}
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
