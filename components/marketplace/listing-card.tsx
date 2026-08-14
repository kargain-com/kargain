"use client";

import Link from "next/link";
import {
  ShieldCheckIcon,
  ShieldWarningIcon,
  UserIcon,
  WarningIcon,
  type IconComponent,
} from "@/components/ui/icons";

import type { MarketplaceListingRow } from "@/app/actions/marketplace-listings";
import { ListingDisplayPrice } from "@/components/marketplace/listing-display-price";
import { ContentImage } from "@/components/media/content-image";
import { PassportIdLabel } from "@/components/passport/passport-id-label";
import { VerifierInactiveBadge } from "@/components/passport/verifier-inactive-badge";
import { Card, CardContent } from "@/components/ui/card";
import { KarProBadge } from "@/components/ui/kar-pro-badge";
import {
  elevatedAdvisoryChip,
  elevatedAdvisoryText,
} from "@/lib/design/instrument-classes";
import { hasListingAgent } from "@/lib/marketplace/listing-agent";
import {
  LISTING_CARD_IMAGE_SIZES,
  isListingCardFirstViewport,
} from "@/lib/marketplace/listing-card-grid";
import {
  LISTING_CARD_IMAGE_FRAME,
  LISTING_CARD_IMAGE_PLACEHOLDER,
} from "@/lib/marketplace/listing-card-media";
import { cn } from "@/lib/utils";
import { shortAddress } from "@/lib/web3/wallet-display";

type Props = {
  row: MarketplaceListingRow;
  /** Index in the browse grid — first-viewport covers get `priority`. */
  index?: number;
};

const ATTRIBUTION_LINK_BASE =
  "transition-colors duration-200 focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]";

/** Shared card attribution row: icon + label + link to a profile. */
function AttributionRow({
  icon: Icon,
  iconClassName,
  label,
  address,
  linkClassName,
}: {
  icon: IconComponent;
  iconClassName: string;
  label: string;
  address: string;
  linkClassName: string;
}) {
  return (
    <div className="flex items-center gap-1.5 mt-1">
      <Icon size={12} className={cn("shrink-0", iconClassName)} aria-hidden />
      <p className="font-sans text-xs text-text-secondary truncate">
        {label}{" "}
        <Link
          href={`/profile/${address}`}
          className={cn(ATTRIBUTION_LINK_BASE, linkClassName)}
          onClick={(e) => e.stopPropagation()}
        >
          {shortAddress(address)}
        </Link>
      </p>
    </div>
  );
}

function titleIncludesYear(title: string, year: number | null): boolean {
  return year != null && title.startsWith(`${year} `);
}

export function ListingCard({ row, index }: Props) {
  const disputer = row.lastDisputer.trim();
  const priority =
    index !== undefined ? isListingCardFirstViewport(index) : false;

  return (
    <Link
      href={`/marketplace/${row.tokenId}?chain=${row.chainId}`}
      className="group flex h-full focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
    >
      <Card
        className={cn(
          "flex h-full w-full flex-col overflow-hidden bg-bg-card p-0 transition-colors duration-300",
          row.passportStatus === "VERIFIED"
            ? "border-accent-warm group-focus-visible:border-accent-warm"
            : "border-border-default hover:border-border-hover group-focus-visible:border-border-hover",
        )}
      >
        <div className={LISTING_CARD_IMAGE_FRAME}>
          {row.imageUrl ? (
            <ContentImage
              src={row.imageUrl}
              alt={row.title}
              sizes={LISTING_CARD_IMAGE_SIZES}
              priority={priority}
            />
          ) : (
            <div className={LISTING_CARD_IMAGE_PLACEHOLDER}>No image</div>
          )}
        </div>
        <CardContent className="flex flex-1 flex-col gap-2.5 p-6">
          {row.duplicateVin && (
            <div className={elevatedAdvisoryChip}>
              <WarningIcon
                size={12}
                className={cn("shrink-0", elevatedAdvisoryText)}
                aria-hidden
              />
              <span className={cn("font-sans text-xs font-medium", elevatedAdvisoryText)}>
                Duplicate VIN
              </span>
            </div>
          )}
          <div className="flex flex-wrap items-start gap-2">
            <h3 className="line-clamp-2 min-w-0 flex-1 text-sm font-medium leading-snug text-text-primary">
              {row.title}
            </h3>
            {row.passportStatus === "VERIFIED" && row.verifier && (
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
          {row.passportStatus === "VERIFIED" && row.verifier.trim() !== "" && (
            <AttributionRow
              icon={ShieldCheckIcon}
              iconClassName="text-accent-warm"
              label="Verified by"
              address={row.verifier}
              linkClassName="font-mono text-xs text-text-secondary hover:text-accent-warm focus-visible:text-accent-warm"
            />
          )}
          {row.passportStatus === "DISPUTED" &&
            (disputer ? (
              <AttributionRow
                icon={ShieldWarningIcon}
                iconClassName="text-status-error"
                label="Disputed by"
                address={disputer}
                linkClassName="font-mono text-xs text-text-secondary hover:text-status-error focus-visible:text-status-error"
              />
            ) : (
              <div className="flex items-center gap-1.5 mt-1">
                <ShieldWarningIcon size={12} className="text-status-error shrink-0" aria-hidden />
                <p className="font-sans text-xs text-status-error truncate">Disputed</p>
              </div>
            ))}
          {hasListingAgent(row.agent) && (
            <AttributionRow
              icon={UserIcon}
              iconClassName="text-accent-warm"
              label="Sold by"
              address={row.agent!}
              linkClassName="text-text-primary hover:text-accent-warm"
            />
          )}

          <div className="mt-auto flex flex-col gap-2.5 pt-1.5">
            <ListingDisplayPrice
              facts={{
                chainId: row.chainId,
                price: row.price,
                denominationKind: row.denominationKind,
                asset: row.asset,
                currencyCode: row.currencyCode,
                fiatCurrency: row.fiatCurrency,
              }}
            />
            <PassportIdLabel
              tokenId={row.tokenId}
              chainId={row.chainId}
              prefix="none"
              variant="mono"
            />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
