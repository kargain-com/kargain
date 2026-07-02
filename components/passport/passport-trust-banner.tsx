import { AlertTriangle, Info, ShieldOff } from "lucide-react";

import { sansLinkUnderline } from "@/lib/design/instrument-classes";
import type { PassportStatus } from "@/lib/types/ponder";
import { cn } from "@/lib/utils";

type Props = {
  verificationResetCount: number;
  hadDispute: boolean;
  status: PassportStatus;
  className?: string;
};

function formatResetCount(count: number): string {
  return count === 1 ? "1 time" : `${count} times`;
}

export function PassportTrustBanner({
  verificationResetCount,
  hadDispute,
  status,
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
          <AlertTriangle size={20} strokeWidth={1.5} aria-hidden />
        </div>
        <div className="flex flex-col gap-1">
          <p className="font-sans text-sm font-medium text-text-primary">
            Metadata updated after verification
          </p>
          <p className="font-sans text-sm text-text-secondary">
            This passport&apos;s metadata was changed {formatResetCount(verificationResetCount)}{" "}
            after it was verified, resetting verification each time. Review the URI history for
            details.
          </p>
        </div>
      </div>
    );
  }

  if (hadDispute) {
    return (
      <div
        className={cn(
          "flex gap-3 rounded-md border border-border-default bg-bg-card p-4",
          className,
        )}
        role="status"
      >
        <div className="shrink-0 text-text-secondary mt-0.5">
          <Info size={20} strokeWidth={1.5} aria-hidden />
        </div>
        <div className="flex flex-col gap-1">
          <p className="font-sans text-sm font-medium text-text-primary">Previously disputed</p>
          <p className="font-sans text-sm text-text-secondary">
            This passport was disputed and resolved. Review the record timeline for details.
          </p>
        </div>
      </div>
    );
  }

  if (status === "UNVERIFIED") {
    return (
      <div
        className={cn(
          "flex gap-3 rounded-md border border-border-default bg-bg-card p-4",
          className,
        )}
        role="status"
      >
        <div className="shrink-0 text-text-secondary mt-0.5">
          <ShieldOff size={20} strokeWidth={1.5} aria-hidden />
        </div>
        <div className="flex flex-col gap-2">
          <p className="font-sans text-sm font-medium text-text-primary">Not yet verified</p>
          <p className="font-sans text-sm text-text-secondary">
            Vehicle details have not been independently confirmed. An active KarPro verifier can
            inspect this vehicle and validate its history on-chain.
          </p>
          <a
            href="/verifiers"
            className={sansLinkUnderline}
          >
            Find a verifier →
          </a>
        </div>
      </div>
    );
  }

  return null;
}
