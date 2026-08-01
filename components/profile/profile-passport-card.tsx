import Link from "next/link";

import { PassportIdLabel } from "@/components/passport/passport-id-label";
import { PassportStatusBadge } from "@/components/ui/passport-status-badge";
import {
  LISTING_CARD_IMAGE,
  LISTING_CARD_IMAGE_FRAME,
  LISTING_CARD_IMAGE_PLACEHOLDER,
} from "@/lib/marketplace/listing-card-media";
import { isProfilePassportBridgedAway } from "@/lib/passport/map-profile-passport";
import {
  derivePassportPresence,
  derivePassportTrustDisplay,
} from "@/lib/passport/presence";
import { buildProfilePassportTitle } from "@/lib/passport/vehicle-label";
import type { PassportStatus } from "@/lib/types/ponder";
import { cn } from "@/lib/utils";
import { shortChainName } from "@/lib/web3/supported-chains";

export type ProfilePassportCardProps = {
  tokenId: string;
  status: PassportStatus;
  /** Origin chain for id label. */
  chainId: number;
  /** Custody chain for detail link + bridged-away badge. */
  custodyChain: number;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  vin?: string | null;
  imageUrl?: string | null;
  /** Own-profile bridge transit overlay. */
  transitBadge?: string | null;
  hrefChainId?: number;
};

/** Reserved two-line title block — keeps tile height stable across labels. */
const TITLE_SLOT =
  "line-clamp-2 min-h-[2.5rem] text-sm font-medium leading-snug text-text-primary";

/** Fixed mono meta lines under the title (state + VIN). */
const META_SLOT = "h-4 truncate font-mono text-xs tabular-nums text-text-tertiary";

export function ProfilePassportCard({
  tokenId,
  status,
  chainId,
  custodyChain,
  make,
  model,
  year,
  vin,
  imageUrl,
  transitBadge,
  hrefChainId,
}: ProfilePassportCardProps) {
  const bridgedAway =
    !transitBadge && isProfilePassportBridgedAway(chainId, custodyChain);
  // Inventory presence from indexer location — not escrow custody.
  const presence = derivePassportPresence({
    viewChainId: chainId,
    // Profile tiles have no RPC lock read; custody mismatch means away.
    custodyLocked: bridgedAway || Boolean(transitBadge) ? true : false,
    ponderCustodyChain: custodyChain,
    locationChainId: custodyChain,
  });
  const trustDisplay = derivePassportTrustDisplay(presence, status);
  const linkChain = hrefChainId ?? custodyChain;
  const title = buildProfilePassportTitle({
    year,
    make,
    model,
    tokenId,
    chainId,
  });
  const stateText = transitBadge
    ? transitBadge
    : bridgedAway
      ? `on ${shortChainName(custodyChain)}`
      : "";
  const vinText = vin?.trim() ?? "";

  return (
    <Link
      href={`/marketplace/${tokenId}?chain=${linkChain}`}
      className={cn(
        "group flex h-full flex-col overflow-hidden rounded-md border bg-bg-card transition-colors duration-150",
        "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
        trustDisplay.showVerifiedAccent
          ? "border-accent-warm group-focus-visible:border-accent-warm"
          : "border-border-default hover:border-border-hover group-focus-visible:border-border-hover",
      )}
    >
      <div className={LISTING_CARD_IMAGE_FRAME}>
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={title}
            className={LISTING_CARD_IMAGE}
            loading="lazy"
          />
        ) : (
          <div className={LISTING_CARD_IMAGE_PLACEHOLDER}>No image</div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <h3 className={TITLE_SLOT}>{title}</h3>
        <div className="flex min-w-0 items-center gap-2">
          {trustDisplay.badgeStatus != null ? (
            <PassportStatusBadge
              status={trustDisplay.badgeStatus}
              className="shrink-0"
            />
          ) : null}
          <PassportIdLabel
            tokenId={tokenId}
            chainId={chainId}
            prefix="none"
            variant="mono"
            className="min-w-0 truncate text-text-secondary"
          />
        </div>
        <p
          className={META_SLOT}
          title={stateText || undefined}
        >
          {stateText || "\u00a0"}
        </p>
        <p className={META_SLOT} title={vinText || undefined}>
          {vinText || "\u00a0"}
        </p>
      </div>
    </Link>
  );
}
