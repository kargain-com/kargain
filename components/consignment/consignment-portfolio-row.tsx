import Link from "next/link";
import type { ReactNode } from "react";

import { PassportIdLabel } from "@/components/passport/passport-id-label";
import { EnsWalletLink } from "@/components/ui/ens-wallet-link";
import {
  categoryLabel,
  sansLink,
} from "@/lib/design/instrument-classes";
import { cn } from "@/lib/utils";

export type ConsignmentPortfolioRowProps = {
  tokenId: string;
  chainId: number;
  href: string;
  statusLabel: string;
  trackLabel: "Fixed price" | "Auction";
  peerAddress?: string | null;
  peerLabel?: "Agent" | "Owner";
  make?: string | null;
  model?: string | null;
  year?: number | null;
  attention?: boolean;
  extraMeta?: ReactNode;
  children?: ReactNode;
};

export function ConsignmentPortfolioRow({
  tokenId,
  chainId,
  href,
  statusLabel,
  trackLabel,
  peerAddress,
  peerLabel = "Agent",
  make,
  model,
  year,
  attention = false,
  extraMeta,
  children,
}: ConsignmentPortfolioRowProps) {
  const title =
    make && model
      ? `${year != null && year > 0 ? `${year} ` : ""}${make} ${model}`
      : null;

  return (
    <div
      className={cn(
        "rounded-md border bg-bg-surface px-4 py-3 text-sm",
        attention ? "border-border-hover" : "border-border-default",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={href}
              className="text-text-primary underline-offset-2 hover:text-accent-warm hover:underline focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
            >
              <PassportIdLabel
                tokenId={tokenId}
                chainId={chainId}
                prefix="none"
                variant="mono"
                className="text-inherit"
              />
            </Link>
            <span className={categoryLabel}>{trackLabel}</span>
          </div>
          {title && (
            <p className="font-sans text-sm text-text-primary">{title}</p>
          )}
          <p className="font-sans text-xs text-text-secondary">{statusLabel}</p>
          {peerAddress ? (
            <p className="font-sans text-xs text-text-secondary">
              {peerLabel}{" "}
              <EnsWalletLink
                address={peerAddress}
                href={`/profile/${peerAddress}`}
                className="hover:underline"
              />
            </p>
          ) : null}
          {extraMeta}
        </div>
        <Link href={href} className={cn(sansLink, "shrink-0")}>
          View
        </Link>
      </div>
      {children}
    </div>
  );
}
