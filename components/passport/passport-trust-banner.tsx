import { CircleInformationIcon, WarningIcon } from "@/components/ui/icons";

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
          <WarningIcon size={20} aria-hidden />
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
          <CircleInformationIcon size={20} aria-hidden />
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

  return null;
}
