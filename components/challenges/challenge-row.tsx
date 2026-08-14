"use client";

import { ArrowRightIcon, ShieldWarningIcon } from "@/components/ui/icons";
import Link from "next/link";

import { ContentImage } from "@/components/media/content-image";
import { PassportIdLabel } from "@/components/passport/passport-id-label";
import {
  challengeInstanceLabel,
  challengeStatusLabel,
  challengeSubjectHref,
  challengeWindowFeedLine,
} from "@/lib/commerce/challenge-display";
import type { ChallengeRecord } from "@/lib/commerce/ponder-consignment";
import {
  monoLinkSm,
  monoTimestampTertiary,
  serialLabel,
  trustStampBase,
  trustStampDisputed,
  trustStampNeutral,
} from "@/lib/design/instrument-classes";
import { formatRelativeTime } from "@/lib/format/relative-time";
import { formatReturnCountdown } from "@/lib/marketplace/return-cooldown";
import { buildVehicleLabel } from "@/lib/passport/vehicle-label";
import { resolveUri } from "@/lib/storage/resolve-uri";
import { cn } from "@/lib/utils";
import { shortAddress } from "@/lib/web3/wallet-display";
import { useNow } from "@/hooks/use-now";

export type ChallengeRowProps = {
  challenge: ChallengeRecord;
  /** Verifier read-only advisory on profile tab. */
  verifierAdvisory?: boolean;
  className?: string;
};

export function ChallengeRow({
  challenge,
  verifierAdvisory = false,
  className,
}: ChallengeRowProps) {
  const nowSec = useNow(challenge.status === "open" ? 1_000 : 60_000);
  const vehicleLabel = buildVehicleLabel(
    challenge.year,
    challenge.make,
    challenge.model,
  );
  const openedLabel =
    challenge.openedAt > 0
      ? formatRelativeTime(new Date(challenge.openedAt * 1000))
      : "";
  const { phase, remainingSec, elapsedCopy } = challengeWindowFeedLine(
    challenge,
    nowSec,
  );
  const href = challengeSubjectHref(challenge);
  const coverUri = challenge.coverPhotoUri
    ? resolveUri(challenge.coverPhotoUri, challenge.chainId)
    : null;
  const statusIsOpen = challenge.status === "open";

  return (
    <article
      className={cn(
        "overflow-hidden rounded-md border border-border-default bg-bg-surface",
        className,
      )}
    >
      <div className="flex gap-0 sm:gap-4">
        {coverUri && (
          <div className="relative hidden w-28 shrink-0 self-stretch sm:block">
            <ContentImage src={coverUri} alt="" sizes="112px" />
          </div>
        )}

        <div className="min-w-0 flex-1 space-y-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {statusIsOpen && (
                <ShieldWarningIcon
                  size={16}
                  className="shrink-0 text-status-error"
                  aria-hidden
                />
              )}
              <span
                className={cn(
                  trustStampBase,
                  statusIsOpen ? trustStampDisputed : trustStampNeutral,
                )}
              >
                {challengeStatusLabel(challenge.status)}
              </span>
              <span className={serialLabel}>{challengeInstanceLabel(challenge.instance)}</span>
            </div>
            <PassportIdLabel
              tokenId={challenge.subjectId}
              chainId={challenge.chainId}
              prefix="none"
              variant="mono"
              className="text-text-tertiary"
            />
          </div>

          {vehicleLabel && (
            <p className="font-sans text-sm text-text-primary">{vehicleLabel}</p>
          )}

          {verifierAdvisory && (
            <p className="font-sans text-sm text-text-secondary">
              You verified this passport, so you cannot resolve this challenge. An
              independent KarPro must decide, or the window ends in a lapse.
            </p>
          )}

          {challenge.status === "open" && challenge.windowDuration > 0 && (
            <p className="font-sans text-xs text-text-secondary">
              {phase === "elapsed" && elapsedCopy ? (
                <>{elapsedCopy}</>
              ) : phase === "active" ? (
                <>
                  Window ends in{" "}
                  <span className="font-mono tabular-nums">
                    {formatReturnCountdown(BigInt(remainingSec))}
                  </span>
                </>
              ) : null}
            </p>
          )}

          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {openedLabel && (
              <span className={monoTimestampTertiary}>{openedLabel}</span>
            )}
            <span className="font-mono text-xs text-text-secondary tabular-nums">
              Opened by {shortAddress(challenge.challenger)}
            </span>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-border-default pt-3">
            <Link href={href} className={cn(monoLinkSm, "inline-flex items-center gap-1")}>
              {challenge.instance === "passport" ? "Passport actions" : "View lot"}
              <ArrowRightIcon size={14} aria-hidden />
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}

export function ChallengeRowSkeleton() {
  return (
    <div
      className="animate-pulse rounded-md border border-border-default bg-bg-surface p-4"
      aria-hidden
    >
      <div className="mb-3 h-4 w-32 rounded-sm bg-bg-primary" />
      <div className="mb-2 h-4 w-3/4 max-w-xs rounded-sm bg-bg-primary" />
      <div className="h-3 w-48 rounded-sm bg-bg-primary" />
    </div>
  );
}
