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
  className,
}: {
  status: PassportStatus;
  className?: string;
}) {
  if (status === "VERIFIED") {
    return (
      <span className={cn(trustStampBase, trustStampVerified, className)}>
        <ShieldCheck size={12} strokeWidth={1.5} aria-hidden="true" />
        {labels.VERIFIED}
      </span>
    );
  }

  if (status === "DISPUTED") {
    return (
      <span className={cn(trustStampBase, trustStampDisputed, className)}>
        <AlertTriangle size={12} strokeWidth={1.5} aria-hidden="true" />
        {labels.DISPUTED}
      </span>
    );
  }

  return (
    <span className={cn(trustStampBase, trustStampNeutral, className)}>
      {labels.UNVERIFIED}
    </span>
  );
}
