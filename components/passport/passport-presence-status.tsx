"use client";

import { PassportPhotoGallery } from "@/components/passport/passport-photo-gallery";
import { PassportStatusBadge } from "@/components/ui/passport-status-badge";
import { usePassportPresence } from "@/hooks/use-passport-presence";
import type { PassportStatus } from "@/lib/types/ponder";
import { shortChainName } from "@/lib/web3/supported-chains";

type BadgeProps = {
  tokenId: string;
  chainId: number;
  ponderCustodyChain: number | null;
  /** Fold cause from indexer — never re-derived from raw fields at chrome. */
  custodyUnresolved?: string | null;
  recordedStatus: PassportStatus;
  sublabel?: string;
  className?: string;
};

/**
 * Status badge gated by presence — never asserts live VERIFIED while away.
 */
export function PassportPresenceStatusBadge({
  tokenId,
  chainId,
  ponderCustodyChain,
  custodyUnresolved,
  recordedStatus,
  sublabel,
  className,
}: BadgeProps) {
  const { presence, presenceCopy, trustDisplay } = usePassportPresence({
    chainId,
    tokenId,
    ponderCustodyChain,
    custodyUnresolved,
  });
  const display = trustDisplay(recordedStatus);

  if (display.badgeStatus == null) {
    if (
      presence.status === "location_unread" ||
      presence.status === "location_unresolved"
    ) {
      return (
        <span
          className={
            className ??
            "inline-flex max-w-[14rem] items-start text-left font-sans text-[10px] leading-snug text-text-secondary"
          }
          role="status"
        >
          {presenceCopy}
        </span>
      );
    }
    const location =
      presence.status === "away" && presence.locationChainId != null
        ? shortChainName(presence.locationChainId)
        : ponderCustodyChain != null && ponderCustodyChain !== chainId
          ? shortChainName(ponderCustodyChain)
          : null;
    return (
      <span
        className={
          className ??
          "inline-flex items-center font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary"
        }
        role="status"
      >
        {location ? `On ${location}` : "Away"}
      </span>
    );
  }

  return (
    <PassportStatusBadge
      status={display.badgeStatus}
      sublabel={
        display.showVerifiedAccent || display.badgeStatus === "DISPUTED"
          ? sublabel
          : undefined
      }
      className={className}
    />
  );
}

type GalleryProps = {
  tokenId: string;
  chainId: number;
  ponderCustodyChain: number | null;
  custodyUnresolved?: string | null;
  recordedStatus: PassportStatus;
  photos: string[];
};

/** Gallery with verified framing only when trust is current here. */
export function PassportPresenceGallery({
  tokenId,
  chainId,
  ponderCustodyChain,
  custodyUnresolved,
  recordedStatus,
  photos,
}: GalleryProps) {
  const { trustDisplay } = usePassportPresence({
    chainId,
    tokenId,
    ponderCustodyChain,
    custodyUnresolved,
  });
  const display = trustDisplay(recordedStatus);
  return (
    <PassportPhotoGallery
      photos={photos}
      chainId={chainId}
      verified={display.showVerifiedFrame}
    />
  );
}
