"use client";

import { Car, Inbox, PlusCircle, User } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { useAccount } from "wagmi";

import { XmtpUnreadBadge } from "@/components/messaging/xmtp-unread-badge";
import { cn } from "@/lib/utils";

const leftItems = [
  { href: "/", label: "Marketplace", Icon: Car, match: (p: string) => p === "/" },
  {
    href: "/messages",
    label: "Messages",
    Icon: Inbox,
    match: (p: string) => p.startsWith("/messages"),
    requireWallet: true as const,
  },
] as const;

function tabLinkClass(active: boolean, extra?: string) {
  return cn(
    "flex min-h-11 flex-col items-center justify-center gap-1 border-t-2 pt-0.5 font-sans text-xs transition-colors duration-200",
    active ? "border-accent-warm text-text-primary" : "border-transparent text-text-secondary",
    extra,
  );
}

export function MobileBottomNav() {
  const path = usePathname();
  const { address, isConnected } = useAccount();
  const profileHref = address ? `/profile/${encodeURIComponent(address)}` : "/profile/edit";

  const visibleLeftItems = useMemo(
    () => leftItems.filter((i) => !("requireWallet" in i && i.requireWallet) || isConnected),
    [isConnected],
  );

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-border-default bg-bg-primary pb-[env(safe-area-inset-bottom)] md:hidden"
      aria-label="Mobile primary"
    >
      <ul className="flex h-16 items-end px-2">
        <li className="flex flex-1 justify-around">
          <ul className="flex w-full justify-around">
            {visibleLeftItems.map(({ href, label, Icon, match }) => {
              const active = match(path);
              const isMessages = href === "/messages";
              return (
                <li key={href}>
                  <Link href={href} className={tabLinkClass(active, "relative")}>
                    <span className="relative">
                      <Icon size={24} strokeWidth={1.5} aria-hidden />
                      {isMessages && <XmtpUnreadBadge className="top-0 right-0" />}
                    </span>
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </li>

        <li className="flex shrink-0 items-center justify-center px-3">
          <Link
            href="/passport/new"
            aria-label="Create passport"
            className="relative -mt-5 flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white text-bg-primary ring-4 ring-bg-primary transition-transform duration-150 active:scale-95"
          >
            <PlusCircle size={24} strokeWidth={1.5} aria-hidden />
          </Link>
        </li>

        <li className="flex flex-1 justify-end">
          <Link
            href={profileHref}
            className={tabLinkClass(path.startsWith("/profile"), "px-4")}
          >
            <User size={24} strokeWidth={1.5} aria-hidden />
            Profile
          </Link>
        </li>
      </ul>
    </nav>
  );
}
