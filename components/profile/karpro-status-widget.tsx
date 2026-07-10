"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { useMinStakeNative } from "@/hooks/use-min-stake-native";
import { categoryLabel } from "@/lib/design/instrument-classes";
import { karProSectionHref } from "@/lib/kar-pro/kar-pro-section-url";

export type KarProStatusWidgetProps = {
  isOwner: boolean;
  isActiveVerifier: boolean;
  joinedAt: number;
};

export function KarProStatusWidget({
  isOwner,
  isActiveVerifier,
}: KarProStatusWidgetProps) {
  const { stakeLabel } = useMinStakeNative();

  if (!isOwner || !isActiveVerifier) {
    return null;
  }

  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-border-default bg-bg-surface p-4">
      <div>
        <span className={categoryLabel}>
          KarPro status
        </span>
        <p className="mt-1 font-sans text-sm text-text-secondary">
          <span className="font-mono tabular-nums text-text-primary">{stakeLabel} ETH</span>
          {" staked · Stake is fully refundable · No slash · No delay"}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-1">
        <Link href={karProSectionHref("fee")}>
          <Button variant="ghost" size="sm">
            Edit fee →
          </Button>
        </Link>
        <Link href={karProSectionHref("membership")}>
          <Button variant="ghost" size="sm">
            Membership →
          </Button>
        </Link>
      </div>
    </div>
  );
}
