"use client";

import Link from "next/link";
import { Bell } from "lucide-react";

import { useShowBecomeKarPro } from "@/hooks/use-show-become-karpro";

export function NotificationsClient() {
  const showBecomeKarPro = useShowBecomeKarPro();

  return (
    <div className="mx-auto max-w-lg space-y-8">
      {showBecomeKarPro && (
        <Link
          href="/kar-pro"
          className="block rounded-md border border-border-default bg-bg-card p-6 transition-colors duration-200 hover:border-accent-warm focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] md:p-8"
        >
          <p className="font-sans text-base font-medium text-text-primary">Become a KarPro verifier</p>
          <p className="mt-2 font-sans text-sm text-text-secondary">
            Stake to verify vehicle passports and unlock your professional showroom.
          </p>
          <span className="mt-4 inline-block font-sans text-sm text-accent-warm">Learn more →</span>
        </Link>
      )}

      <div className="py-8 text-center">
        <Bell
          size={48}
          strokeWidth={1}
          className="mx-auto text-text-tertiary"
          aria-hidden
        />
        <h1 className="mt-4 font-display text-fluid-h2 font-medium text-text-primary">No alerts yet</h1>
        <p className="mx-auto mt-2 max-w-sm font-sans text-sm text-text-secondary">
          Activity from messages, listings, and KarPro will appear here as the marketplace grows.
        </p>
      </div>
    </div>
  );
}
