"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import type { Address } from "viem";
import { useAccount } from "wagmi";

import { NotificationsUnreadBadge } from "@/components/notifications/notifications-unread-badge";
import { MessagingNavStatus } from "@/components/messaging/messaging-nav-status";
import { IdentityAvatar } from "@/components/identity/identity-avatar";
import {
  AddIcon,
  GridIcon,
  MessageAltIcon,
  NotificationIcon,
  UserIcon,
  type NavIconComponent,
} from "@/components/shell/nav-icons";
import { cn } from "@/lib/utils";

function NavTab({
  href,
  label,
  active,
  icon: Icon,
  badge,
}: {
  href: string;
  label: string;
  active: boolean;
  icon: NavIconComponent;
  badge?: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex min-h-11 w-full min-w-0 flex-col items-center justify-end gap-1 px-0.5 pb-2 pt-1",
        "font-sans text-[10px] leading-tight transition-colors duration-200",
        active ? "text-accent-warm" : "text-text-secondary",
      )}
    >
      <span className="relative flex size-6 shrink-0 items-center justify-center">
        <Icon size={20} />
        {badge}
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
          "flex min-h-11 w-full min-w-0 flex-col items-center justify-end gap-1 px-0.5 pb-2 pt-1",
          "font-sans text-[10px] leading-tight transition-colors duration-200",
          active ? "text-accent-warm" : "text-text-secondary",
        )}
      >
        <span className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full">
          <IdentityAvatar address={address} size={22} className="rounded-full" />
        </span>
        <span className="max-w-full truncate">Profile</span>
      </Link>
    );
  }

  return (
    <Link
      href="/profile/edit"
      className={cn(
        "flex min-h-11 w-full min-w-0 flex-col items-center justify-end gap-1 px-0.5 pb-2 pt-1",
        "font-sans text-[10px] leading-tight transition-colors duration-200",
        active ? "text-accent-warm" : "text-text-secondary",
      )}
    >
      <span className="flex size-6 shrink-0 items-center justify-center">
        <UserIcon size={20} />
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
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 h-28 md:hidden"
      aria-label="Mobile primary"
    >
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="frost-blur-1 absolute inset-0" />
        <div className="frost-blur-2 absolute inset-0" />
        <div className="frost-blur-3 absolute inset-0" />
        <div className="frost-scrim absolute inset-0" />
      </div>

      <div className="pointer-events-auto absolute inset-x-0 bottom-0 pb-[env(safe-area-inset-bottom)]">
        <div className="relative mx-auto grid h-16 max-w-lg grid-cols-5 items-end px-1">
          <NavTab
            href="/"
            label="Marketplace"
            icon={GridIcon}
            active={path === "/"}
          />

          <NavTab
            href="/messages"
            label="Messages"
            icon={MessageAltIcon}
            active={path.startsWith("/messages")}
            badge={isConnected ? <MessagingNavStatus className="-top-0.5 -right-0.5" /> : undefined}
          />

          <div className="flex items-end justify-center">
            <Link
              href="/passport/new"
              aria-label="Create passport"
              className={cn(
                "relative z-10 -top-3 mb-1 flex h-12 w-12 shrink-0 items-center justify-center",
                "rounded-full bg-accent-warm text-bg-primary",
                "transition-transform duration-200 ease-[cubic-bezier(0.33,1,0.68,1)]",
                "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
                "active:scale-95",
              )}
            >
              <AddIcon size={22} />
            </Link>
          </div>

          <NavTab
            href="/notifications"
            label="Alerts"
            icon={NotificationIcon}
            active={path.startsWith("/notifications")}
            badge={isConnected ? <NotificationsUnreadBadge className="-top-0.5 -right-0.5" /> : undefined}
          />

          <ProfileNavTab
            active={path.startsWith("/profile")}
            isConnected={isConnected}
            address={address}
          />
        </div>
      </div>
    </nav>
  );
}
