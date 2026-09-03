"use client";

import { useActiveAccount, requireEvmSession } from "@/hooks/use-active-account";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { usePendingClaims } from "@/hooks/use-pending-claims";
import {
  elevatedAdvisoryPanel,
  elevatedAdvisoryText,
} from "@/lib/design/instrument-classes";
import { cn } from "@/lib/utils";

/** Global indication when the connected wallet has outstanding claims. */
export function ClaimsPendingBanner({ className }: { className?: string }) {
  const { account } = useActiveAccount();
  const evm = requireEvmSession(account);
  const address = evm.ok ? evm.address : undefined;
  const isConnected = evm.ok;
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { total, isLoading } = usePendingClaims();

  if (!isConnected || !address || isLoading || total <= 0) return null;

  const onOwnClaimsTab =
    searchParams.get("tab") === "claims" &&
    Boolean(pathname?.toLowerCase().includes(address.toLowerCase()));

  if (onOwnClaimsTab) return null;

  const label =
    total === 1
      ? "You have funds waiting to withdraw."
      : `You have ${total} claims waiting to withdraw.`;

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
