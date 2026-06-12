"use client";

import Link from "next/link";
import { Inbox, PlusCircle, Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";
import { useAccount } from "wagmi";

import { XmtpUnreadBadge } from "@/components/messaging/xmtp-unread-badge";
import { ChainSelector } from "@/components/shell/chain-selector";
import { KargainLogo } from "@/components/ui/kargain-logo";
import { WalletLoginButton } from "@/components/wallet-login-button";
import { DEFAULT_CHAIN_ID } from "@/lib/web3/supported-chains";

export function AppTopNav() {
  const path = usePathname();
  const sp = useSearchParams();
  const { isConnected } = useAccount();
  const showMarketplaceSearch = path === "/";
  const urlSearch = sp.get("search") ?? sp.get("q") ?? "";

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

        {showMarketplaceSearch && (
          <MarketplaceSearch key={urlSearch} initialSearch={urlSearch} searchParams={sp} />
        )}

        <div className="flex-1" aria-hidden />

        <div className="flex shrink-0 items-center gap-2">
          {isConnected && (
            <Link
              href="/messages"
              aria-label="Messages"
              className="group relative inline-flex h-9 w-9 items-center justify-center rounded-sm text-text-secondary transition-colors duration-200 hover:bg-bg-surface hover:text-text-primary focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
            >
              <Inbox size={20} strokeWidth={1.5} className="transition-colors duration-200" aria-hidden />
              <XmtpUnreadBadge className="top-1.5 right-1.5" />
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
            syncSearchParam={showMarketplaceSearch}
            expectedChainId={expectedChainId}
            className="hidden md:flex"
          />
          <WalletLoginButton />
        </div>
      </div>
    </header>
  );
}

function MarketplaceSearch({
  initialSearch,
  searchParams,
}: {
  initialSearch: string;
  searchParams: ReturnType<typeof useSearchParams>;
}) {
  const router = useRouter();
  const [search, setSearch] = useState(initialSearch);

  const onSearchSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const next = new URLSearchParams(searchParams.toString());
    const value = search.trim();
    if (value) next.set("search", value);
    else next.delete("search");
    next.delete("q");
    const query = next.toString();
    router.push(query ? `/?${query}` : "/");
  };

  return (
    <form onSubmit={onSearchSubmit} className="relative hidden w-48 items-center lg:w-64 md:flex">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-secondary"
        size={16}
        strokeWidth={1.5}
        aria-hidden
      />
      <input
        id="marketplace-search"
        name="marketplaceSearch"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search vehicles…"
        aria-label="Search vehicles"
        className="h-9 w-full rounded-sm border border-transparent bg-bg-surface pl-9 pr-3 font-sans text-sm text-text-primary placeholder:text-text-secondary transition-colors duration-200 focus:border-border-default focus:outline-none focus-visible:shadow-[var(--focus-ring)]"
      />
    </form>
  );
}
