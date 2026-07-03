import { AlertTriangle, ShieldCheck } from "lucide-react";

import {
  trustStampBase,
  trustStampDisputed,
  trustStampNeutral,
  trustStampVerified,
} from "@/lib/design/instrument-classes";
import { cn } from "@/lib/utils";

export type PassportStatus = "UNVERIFIED" | "VERIFIED" | "DISPUTED";

const labels: Record<PassportStatus, string> = {
  UNVERIFIED: "unverified",
  VERIFIED: "verified",
  DISPUTED: "disputed",
};

export function PassportStatusBadge({
  status,
  sublabel,
  className,
}: {
  status: PassportStatus;
  /** Optional second line (detail seal: "under review", short verifier address). */
  sublabel?: string;
  className?: string;
}) {
  const tone =
    status === "VERIFIED"
      ? trustStampVerified
      : status === "DISPUTED"
        ? trustStampDisputed
        : trustStampNeutral;

  const icon =
    status === "VERIFIED" ? (
      <ShieldCheck size={sublabel ? 17 : 12} strokeWidth={1.5} aria-hidden="true" className="shrink-0" />
    ) : status === "DISPUTED" ? (
      <AlertTriangle size={sublabel ? 17 : 12} strokeWidth={1.5} aria-hidden="true" className="shrink-0" />
    ) : null;

  if (sublabel) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-2.5 rounded-sm border bg-bg-surface px-3 py-2",
          tone,
          className,
        )}
      >
        {icon}
        <span className="flex min-w-0 flex-col gap-px">
          <span className="font-mono text-[10.5px] font-medium tracking-[0.09em] uppercase">
            {labels[status]}
          </span>
          <span className="font-mono text-[11px] font-normal normal-case tracking-normal text-text-tertiary">
            {sublabel}
          </span>
        </span>
      </span>
    );
  }

  return (
    <span className={cn(trustStampBase, tone, className)}>
      {icon}
      {labels[status]}
    </span>
  );
}
