"use client";

import { Bookmark, Car, Inbox, Plus, User } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Address } from "viem";
import { useAccount } from "wagmi";

import { XmtpUnreadBadge } from "@/components/messaging/xmtp-unread-badge";
import { EnsAvatar } from "@/components/ui/ens-avatar";
import { cn } from "@/lib/utils";

function NavTab({
  href,
  label,
  active,
  icon: Icon,
  showBadge,
}: {
  href: string;
  label: string;
  active: boolean;
  icon: typeof Car;
  showBadge?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex min-h-11 w-full min-w-0 flex-col items-center justify-end gap-1 border-t-2 px-0.5 pb-2 pt-1",
        "font-sans text-[10px] leading-tight transition-colors duration-200",
        active ? "border-accent-warm text-text-primary" : "border-transparent text-text-secondary",
      )}
    >
      <span className="relative flex size-6 shrink-0 items-center justify-center">
        <Icon size={20} strokeWidth={1.5} aria-hidden />
        {showBadge && <XmtpUnreadBadge className="-top-0.5 -right-0.5" />}
      </span>
      <span className="max-w-full truncate">{label}</span>
    </Link>
  );
}

function ProfileNavTab({
  active,
  isConnected,
  address,
}: {
  active: boolean;
  isConnected: boolean;
  address: Address | undefined;
}) {
  if (isConnected && address) {
    return (
      <Link
        href={`/profile/${encodeURIComponent(address)}`}
        className={cn(
          "flex min-h-11 w-full min-w-0 flex-col items-center justify-end gap-1 border-t-2 px-0.5 pb-2 pt-1",
          "font-sans text-[10px] leading-tight transition-colors duration-200",
          active ? "border-accent-warm text-text-primary" : "border-transparent text-text-secondary",
        )}
      >
        <span className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full">
          <EnsAvatar address={address} size={22} className="rounded-full" />
        </span>
        <span className="max-w-full truncate">Profile</span>
      </Link>
    );
  }

  return (
    <Link
      href="/profile/edit"
      className={cn(
        "flex min-h-11 w-full min-w-0 flex-col items-center justify-end gap-1 border-t-2 px-0.5 pb-2 pt-1",
        "font-sans text-[10px] leading-tight transition-colors duration-200",
        active ? "border-accent-warm text-text-primary" : "border-transparent text-text-secondary",
      )}
    >
      <span className="flex size-6 shrink-0 items-center justify-center">
        <User size={20} strokeWidth={1.5} aria-hidden />
      </span>
      <span className="max-w-full truncate">Connect</span>
    </Link>
  );
}

export function MobileBottomNav() {
  const path = usePathname();
  const { address, isConnected } = useAccount();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-border-default bg-bg-primary pb-[env(safe-area-inset-bottom)] md:hidden"
      aria-label="Mobile primary"
    >
      <div className="relative mx-auto grid h-16 max-w-lg grid-cols-5 items-end px-1">
        <NavTab
          href="/"
          label="Marketplace"
          icon={Car}
          active={path === "/"}
        />

        <NavTab
          href="/messages"
          label="Messages"
          icon={Inbox}
          active={path.startsWith("/messages")}
          showBadge={isConnected}
        />

        <div className="flex items-end justify-center">
          <Link
            href="/passport/new"
            aria-label="Create passport"
            className={cn(
              "relative z-10 -top-3 mb-1 flex h-12 w-12 shrink-0 items-center justify-center",
              "rounded-full border border-border-hover bg-bg-card text-accent-warm ring-2 ring-bg-primary",
              "transition-[border-color,transform] duration-200 ease-[cubic-bezier(0.33,1,0.68,1)]",
              "hover:border-accent-warm",
              "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
              "active:scale-95",
            )}
          >
            <Plus size={20} strokeWidth={1.5} aria-hidden />
          </Link>
        </div>

        <NavTab
          href="/notifications"
          label="Watchlist"
          icon={Bookmark}
          active={path.startsWith("/notifications")}
        />

        <ProfileNavTab
          active={path.startsWith("/profile")}
          isConnected={isConnected}
          address={address}
        />
      </div>
    </nav>
  );
}
