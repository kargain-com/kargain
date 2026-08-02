"use client";

import { PassportPhotoGallery } from "@/components/passport/passport-photo-gallery";
import { PassportStatusBadge } from "@/components/ui/passport-status-badge";
import { usePassportCommerceFacts } from "@/hooks/use-passport-commerce-facts";
import {
  derivePassportPresence,
  derivePassportTrustDisplay,
} from "@/lib/passport/presence";
import type { PassportStatus } from "@/lib/types/ponder";
import { shortChainName } from "@/lib/web3/supported-chains";

type BadgeProps = {
  tokenId: string;
  chainId: number;
  ponderCustodyChain: number;
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
  recordedStatus,
  sublabel,
  className,
}: BadgeProps) {
  const facts = usePassportCommerceFacts({ chainId, tokenId });
  const presence = derivePassportPresence({
    viewChainId: chainId,
    custodyLocked: facts.custodyLocked,
    ponderCustodyChain,
  });
  const display = derivePassportTrustDisplay(presence, recordedStatus);

  if (display.badgeStatus == null) {
    const location =
      presence.status === "away" && presence.locationChainId != null
        ? shortChainName(presence.locationChainId)
        : ponderCustodyChain !== chainId
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
  ponderCustodyChain: number;
  recordedStatus: PassportStatus;
  photos: string[];
};

/** Gallery with verified framing only when trust is current here. */
export function PassportPresenceGallery({
  tokenId,
  chainId,
  ponderCustodyChain,
  recordedStatus,
  photos,
}: GalleryProps) {
  const facts = usePassportCommerceFacts({ chainId, tokenId });
  const presence = derivePassportPresence({
    viewChainId: chainId,
    custodyLocked: facts.custodyLocked,
    ponderCustodyChain,
  });
  const display = derivePassportTrustDisplay(presence, recordedStatus);
  return (
    <PassportPhotoGallery
      photos={photos}
      chainId={chainId}
      verified={display.showVerifiedFrame}
    />
  );
}
