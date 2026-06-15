"use client";

import Link from "next/link";
import { Inbox, PlusCircle } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useAccount, useReadContract } from "wagmi";

import { XmtpUnreadBadge } from "@/components/messaging/xmtp-unread-badge";
import { ChainSelector } from "@/components/shell/chain-selector";
import { KargainLogo } from "@/components/ui/kargain-logo";
import { WalletLoginButton } from "@/components/wallet-login-button";
import { KarProStakingAbi } from "@/lib/contracts/abis.generated";
import { karProStakingAddress } from "@/lib/web3/deployment-addresses";
import { DEFAULT_CHAIN_ID } from "@/lib/web3/supported-chains";

export function AppTopNav() {
  const path = usePathname();
  const sp = useSearchParams();
  const { address, isConnected } = useAccount();
  const staking = karProStakingAddress(DEFAULT_CHAIN_ID);
  const { data: isActiveVerifier } = useReadContract({
    address: staking,
    abi: KarProStakingAbi,
    functionName: "isActiveVerifier",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(isConnected && staking && address) },
  });
  const showBecomeKarPro = isConnected && isActiveVerifier !== true;
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
          className="hidden shrink-0 font-sans text-sm text-text-secondary transition-colors duration-200 hover:text-text-primary focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] md:inline-flex"
        >
          Verifiers
        </Link>

        <div className="flex-1" aria-hidden />

        <div className="flex shrink-0 items-center gap-2">
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
              className="hidden h-9 items-center justify-center rounded-sm bg-transparent px-4 font-sans text-sm font-medium text-text-primary transition-colors duration-200 ease-[cubic-bezier(0.33,1,0.68,1)] hover:bg-bg-surface focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] md:inline-flex"
            >
              Become KarPro
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
