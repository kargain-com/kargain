"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";

export type KarProStatusWidgetProps = {
  isOwner: boolean;
  isActiveVerifier: boolean;
  joinedAt: number;
};

export function KarProStatusWidget({
  isOwner,
  isActiveVerifier,
}: KarProStatusWidgetProps) {
  if (!isOwner || !isActiveVerifier) {
    return null;
  }

  return (
    <div className="flex items-center justify-between gap-4 rounded-sm border border-border-default p-4">
      <div>
        <span className="font-mono text-xs uppercase tracking-[0.18em] text-accent-warm">
          KarPro status
        </span>
        <p className="mt-1 font-sans text-sm text-text-secondary">
          0.05 ETH staked · Stake is fully refundable · No slash · No delay
        </p>
      </div>
      <Link href="/kar-pro">
        <Button variant="ghost" size="sm">
          Manage
        </Button>
      </Link>
    </div>
  );
}
