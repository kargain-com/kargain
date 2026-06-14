"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import type { MarketplaceListingRow } from "@/app/actions/marketplace-listings";
import { VerifierInactiveBadge } from "@/components/passport/verifier-inactive-badge";
import { Card, CardContent } from "@/components/ui/card";
import { KarProBadge } from "@/components/ui/kar-pro-badge";
import { PassportStatusBadge } from "@/components/ui/passport-status-badge";
import type { ListingChainStatusDrift } from "@/lib/passport/confirm-listing-status";
import { fiatCurrencyLabel, formatFiat1e8 } from "@/lib/marketplace/fiat-format";

type Props = {
  row: MarketplaceListingRow;
  chainStatusDrift?: ListingChainStatusDrift;
};

export function ListingCard({ row, chainStatusDrift }: Props) {
  const fiat = formatFiat1e8(row.fiatPrice1e8);
  const cur = fiatCurrencyLabel(row.fiatCurrency);
  const statusStale = Boolean(chainStatusDrift);
  const displayStatus = chainStatusDrift?.chainStatus ?? row.passportStatus;

  return (
    <Link
      href={`/marketplace/${row.tokenId}?chain=${row.chainId}`}
      className="group block focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
    >
      <Card className="h-full overflow-hidden border-border-default bg-bg-card transition-colors duration-300 hover:border-accent-warm group-focus-visible:border-accent-warm">
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
          <div className="pointer-events-none absolute inset-0 bg-bg-surface" />
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
        <CardContent className="space-y-2.5 p-4">
          <div className="flex flex-wrap items-start gap-2">
            <h3 className="line-clamp-2 flex-1 text-sm font-medium leading-snug text-text-primary">{row.title}</h3>
            <PassportStatusBadge status={displayStatus} />
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
            {row.year != null && <span>{row.year}</span>}
            {row.mileageKm != null && <span>{row.mileageKm.toLocaleString()} km</span>}
          </div>
          <p className="text-lg font-medium text-accent-warm transition-colors duration-200 group-hover:text-accent-warm group-focus-visible:text-accent-warm">
            {fiat} <span className="text-xs font-normal text-text-secondary">{cur}</span>
          </p>
          <p className="truncate font-mono text-[10px] text-text-secondary">
            #{row.tokenId} · ch {row.chainId}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}
