"use client";

import { useActiveAccount } from "@/hooks/use-active-account";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { usePendingClaims } from "@/hooks/use-pending-claims";
import {
  elevatedAdvisoryPanel,
  elevatedAdvisoryText,
} from "@/lib/design/instrument-classes";
import { admitSessionSurface, admitSurfaceEvmAddress } from "@/lib/web3/surface-admission";
import { cn } from "@/lib/utils";

/** Global indication when the connected wallet has a known outstanding claim total. */
export function ClaimsPendingBanner({ className }: { className?: string }) {
  const { account } = useActiveAccount();
  const admission = admitSessionSurface(account, "pending_claims");
  const address = admitSurfaceEvmAddress(admission);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const fact = usePendingClaims();

  if (fact.status !== "known" || fact.total <= 0 || !address) return null;

  const onOwnClaimsTab =
    searchParams.get("tab") === "claims" &&
    Boolean(pathname?.toLowerCase().includes(address.toLowerCase()));

  if (onOwnClaimsTab) return null;

  const label =
    fact.total === 1
      ? "You have funds waiting to withdraw."
      : `You have ${fact.total} claims waiting to withdraw.`;

  return (
    <div
      className={cn(
        elevatedAdvisoryPanel,
        "mx-auto my-3 flex w-full max-w-6xl flex-col gap-3 px-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8",
        className,
      )}
      role="status"
    >
      <p className={cn("text-sm", elevatedAdvisoryText)}>{label}</p>
      <Button variant="secondary" size="sm" className="shrink-0" asChild>
        <Link href={`/profile/${address}?tab=claims`}>View claims</Link>
      </Button>
    </div>
  );
}
