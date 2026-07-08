"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount } from "wagmi";

import { Button } from "@/components/ui/button";
import { useOwnProfileNeedsReattestation } from "@/hooks/use-own-profile-needs-reattestation";
import { sansLink } from "@/lib/design/instrument-classes";

type ProfileReattestBannerProps = {
  variant?: "full" | "compact";
  className?: string;
};

const PANEL_CLASS =
  "rounded-md border border-border-default bg-bg-surface p-4";

export function ProfileReattestBanner({
  variant = "full",
  className,
}: ProfileReattestBannerProps) {
  const { address } = useAccount();
  const pathname = usePathname();
  const { needsReattestation, loading } = useOwnProfileNeedsReattestation(address);

  if (!address || loading || !needsReattestation) {
    return null;
  }

  const onEditPage = pathname === "/profile/edit";

  if (variant === "compact") {
    return (
      <div className={className ?? PANEL_CLASS} role="status">
        <p className="text-sm text-text-secondary">
          Re-save your profile so payment chips and Lightning settings stay visible to others.{" "}
          <Link href="/profile/edit" className={sansLink}>
            Re-save profile →
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div
      className={
        className ??
        `flex flex-col gap-3 ${PANEL_CLASS} sm:flex-row sm:items-start sm:justify-between`
      }
      role="status"
    >
      <div className="space-y-1">
        <p className="text-sm text-text-primary">
          Re-save your profile to keep it visible
        </p>
        <p className="text-sm text-text-secondary">
          Kargain now verifies profile ownership. Your existing profile needs one re-save
          (one wallet signature) to stay visible to others.
        </p>
      </div>
      {onEditPage ? (
        <Button variant="secondary" size="sm" className="shrink-0" asChild>
          <a href="#save-profile">Save profile below</a>
        </Button>
      ) : (
        <Button variant="secondary" size="sm" className="shrink-0" asChild>
          <Link href="/profile/edit">Edit profile</Link>
        </Button>
      )}
    </div>
  );
}
