import { AlertTriangle, ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";

export type PassportStatus = "UNVERIFIED" | "VERIFIED" | "DISPUTED";

const base =
  "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-bg-surface border font-mono text-xs font-medium tracking-[0.18em] uppercase";

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
      <span className={cn(base, "border-accent-warm text-accent-warm", className)}>
        <ShieldCheck size={12} strokeWidth={1.5} aria-hidden="true" />
        {labels.VERIFIED}
      </span>
    );
  }

  if (status === "DISPUTED") {
    return (
      <span className={cn(base, "border-status-error text-status-error", className)}>
        <AlertTriangle size={12} strokeWidth={1.5} aria-hidden="true" />
        {labels.DISPUTED}
      </span>
    );
  }

  return (
    <span className={cn(base, "border-border-default text-text-secondary", className)}>
      {labels.UNVERIFIED}
    </span>
  );
}
