import { BadgeCheck } from "lucide-react";

import { cn } from "@/lib/utils";

export function KarProBadge({ name, className }: { name?: string; className?: string }) {
  const label = name ? `verified · ${name}` : "verified pro";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-bg-surface border border-accent-warm/40 font-mono text-xs font-medium tracking-[0.18em] uppercase text-accent-warm",
        className,
      )}
    >
      <BadgeCheck size={12} strokeWidth={1.5} aria-hidden="true" />
      {label}
    </span>
  );
}
