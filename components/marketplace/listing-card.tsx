"use client";

import Link from "next/link";
import { AlertTriangle, ShieldCheck, UserRound } from "lucide-react";

import type { MarketplaceListingRow } from "@/app/actions/marketplace-listings";
import { ListingDisplayPrice } from "@/components/marketplace/listing-display-price";
import { PassportIdLabel } from "@/components/passport/passport-id-label";
import { VerifierInactiveBadge } from "@/components/passport/verifier-inactive-badge";
import { Card, CardContent } from "@/components/ui/card";
import { KarProBadge } from "@/components/ui/kar-pro-badge";
import { hasListingAgent } from "@/lib/marketplace/listing-agent";
import type { ListingChainStatusDrift } from "@/lib/passport/confirm-listing-status";
import { cn } from "@/lib/utils";
import { shortAddress } from "@/lib/web3/wallet-display";

type Props = {
  row: MarketplaceListingRow;
  chainStatusDrift?: ListingChainStatusDrift;
};

function titleIncludesYear(title: string, year: number | null): boolean {
  return year != null && title.startsWith(`${year} `);
}

export function ListingCard({ row, chainStatusDrift }: Props) {
  const statusStale = Boolean(chainStatusDrift);
  const displayStatus = chainStatusDrift?.chainStatus ?? row.passportStatus;

  return (
    <Link
      href={`/marketplace/${row.tokenId}?chain=${row.chainId}`}
      className="group block focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
    >
      <Card
        className={cn(
          "h-full overflow-hidden bg-bg-card p-0 transition-colors duration-300",
          displayStatus === "VERIFIED"
            ? "border-accent-warm group-focus-visible:border-accent-warm"
            : "border-border-default hover:border-border-hover group-focus-visible:border-border-hover",
        )}
      >
        <div className="relative aspect-[16/10] w-full bg-bg-surface">
          {row.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={row.imageUrl}
              alt={row.title}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-text-secondary">
              No image
            </div>
          )}
          {displayStatus === "VERIFIED" && !statusStale && (
            <span className="absolute right-2 top-2 rounded border border-accent-warm/40 bg-bg-primary/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent-warm">
              Verified
            </span>
          )}
          {displayStatus !== "VERIFIED" && (
            <span className="absolute left-2 top-2 rounded border border-status-error/40 bg-bg-primary/80 px-2 py-0.5 text-[10px] font-medium uppercase text-status-error">
              {displayStatus === "DISPUTED" ? "Disputed" : "Unverified"}
            </span>
          )}
          {row.duplicateVin && (
            <span className="absolute bottom-2 left-2 rounded border border-status-error/40 bg-bg-primary/80 px-2 py-0.5 text-[10px] text-status-error">
              Duplicate VIN
            </span>
          )}
        </div>
        <CardContent className="space-y-2.5 p-6">
          <div className="flex flex-wrap items-start gap-2">
            <h3 className="line-clamp-2 min-w-0 flex-1 text-sm font-medium leading-snug text-text-primary">
              {row.title}
            </h3>
            {statusStale && (
              <span
                className="inline-flex items-center gap-1 rounded border border-status-error/40 bg-bg-primary/80 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-status-error"
                title={`Indexer out of sync — on-chain status: ${chainStatusDrift!.chainStatus}`}
              >
                <AlertTriangle size={10} strokeWidth={1.5} aria-hidden />
                On-chain
              </span>
            )}
            {displayStatus === "VERIFIED" && row.verifier && (
              <VerifierInactiveBadge chainId={row.chainId} verifier={row.verifier} />
            )}
            {row.karPro && <KarProBadge className="shrink-0" />}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-secondary">
            {row.make && <span>{row.make}</span>}
            {row.model && <span>{row.model}</span>}
            {row.year != null && !titleIncludesYear(row.title, row.year) && <span>{row.year}</span>}
            {row.mileageKm != null && <span>{row.mileageKm.toLocaleString()} km</span>}
          </div>
          {displayStatus === "VERIFIED" && row.verifier.trim() !== "" && (
            <div className="flex items-center gap-1.5 mt-1">
              <ShieldCheck size={12} strokeWidth={1.5} className="text-accent-warm shrink-0" aria-hidden />
              <p className="font-sans text-xs text-text-secondary truncate">
                Verified by{" "}
                <Link
                  href={`/profile/${row.verifier}`}
                  className="font-mono text-xs text-text-secondary hover:text-accent-warm focus-visible:text-accent-warm transition-colors duration-200
                             focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
                  onClick={(e) => e.stopPropagation()}
                >
                  {shortAddress(row.verifier)}
                </Link>
              </p>
            </div>
          )}
          {hasListingAgent(row.agent) && (
            <div className="flex items-center gap-1.5 mt-1">
              <UserRound size={12} strokeWidth={1.5} className="text-accent-warm shrink-0" aria-hidden />
              <p className="font-sans text-xs text-text-secondary truncate">
                Sold by{" "}
                <Link
                  href={`/profile/${row.agent}`}
                  className="text-text-primary hover:text-accent-warm transition-colors duration-200
                             focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
                  onClick={(e) => e.stopPropagation()}
                >
                  {shortAddress(row.agent!)}
                </Link>
              </p>
            </div>
          )}
          <ListingDisplayPrice
            fiatPrice1e8={row.fiatPrice1e8}
            fiatCurrency={row.fiatCurrency}
          />
          <PassportIdLabel
            tokenId={row.tokenId}
            chainId={row.chainId}
            prefix="none"
            variant="mono"
          />
        </CardContent>
      </Card>
    </Link>
  );
}
