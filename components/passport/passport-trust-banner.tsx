import { CircleInformationIcon, WarningIcon } from "@/components/ui/icons";

import { challengeTrustCopyKind } from "@/lib/challenge";
import type { PassportStatus } from "@/lib/types/ponder";
import { cn } from "@/lib/utils";

type Props = {
  verificationResetCount: number;
  hadDispute: boolean;
  status: PassportStatus;
  lastDisputeTerminal?: string;
  className?: string;
};

function formatResetCount(count: number): string {
  return count === 1 ? "1 time" : `${count} times`;
}

export function PassportTrustBanner({
  verificationResetCount,
  hadDispute,
  status,
  lastDisputeTerminal = "",
  className,
}: Props) {
  if (verificationResetCount > 0) {
    return (
      <div
        className={cn(
          "flex gap-3 rounded-md border border-status-warning bg-bg-card p-4",
          className,
        )}
        role="status"
      >
        <div className="shrink-0 text-status-warning mt-0.5">
          <WarningIcon size={20} aria-hidden />
        </div>
        <div className="flex flex-col gap-1">
          <p className="font-sans text-sm font-medium text-text-primary">
            Verification was reset
          </p>
          <p className="font-sans text-sm text-text-secondary">
            A recorded verification was cleared{" "}
            {formatResetCount(verificationResetCount)} on this passport. Fixed-price
            listing stays available while unverified; reserve auctions need a fresh
            verification. Review the metadata history for details.
          </p>
        </div>
      </div>
    );
  }

  const kind = challengeTrustCopyKind({
    status,
    hadDispute,
    lastDisputeTerminal,
  });

  if (kind === "lapsed") {
    return (
      <div
        className={cn(
          "flex gap-3 rounded-md border border-border-default bg-bg-card p-4",
          className,
        )}
        role="status"
      >
        <div className="shrink-0 text-text-secondary mt-0.5">
          <CircleInformationIcon size={20} aria-hidden />
        </div>
        <div className="flex flex-col gap-1">
          <p className="font-sans text-sm font-medium text-text-primary">
            Verification lapsed
          </p>
          <p className="font-sans text-sm text-text-secondary">
            The dispute window ended without a professional judgment. This is not a penalty —
            the assertion lost its backing. A fresh inspection by a KarPro restores
            verification.
          </p>
        </div>
      </div>
    );
  }

  if (kind === "upheld") {
    return (
      <div
        className={cn(
          "flex gap-3 rounded-md border border-border-default bg-bg-card p-4",
          className,
        )}
        role="status"
      >
        <div className="shrink-0 text-text-secondary mt-0.5">
          <CircleInformationIcon size={20} aria-hidden />
        </div>
        <div className="flex flex-col gap-1">
          <p className="font-sans text-sm font-medium text-text-primary">
            Dispute upheld
          </p>
          <p className="font-sans text-sm text-text-secondary">
            An independent KarPro confirmed the challenge and cleared verification. A fresh
            inspection restores it.
          </p>
        </div>
      </div>
    );
  }

  if (kind === "previously_disputed") {
    return (
      <div
        className={cn(
          "flex gap-3 rounded-md border border-border-default bg-bg-card p-4",
          className,
        )}
        role="status"
      >
        <div className="shrink-0 text-text-secondary mt-0.5">
          <CircleInformationIcon size={20} aria-hidden />
        </div>
        <div className="flex flex-col gap-1">
          <p className="font-sans text-sm font-medium text-text-primary">Previously disputed</p>
          <p className="font-sans text-sm text-text-secondary">
            This passport was disputed and closed. Review the record timeline for details.
          </p>
        </div>
      </div>
    );
  }

  return null;
}
