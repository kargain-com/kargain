import { BadgeCheck } from "lucide-react";

import { trustStampBase, trustStampKarPro } from "@/lib/design/instrument-classes";
import { cn } from "@/lib/utils";

export function KarProBadge({ name, className }: { name?: string; className?: string }) {
  const label = name ? `verified · ${name}` : "verified pro";

  return (
    <span className={cn(trustStampBase, trustStampKarPro, className)}>
      <BadgeCheck size={12} strokeWidth={1.5} aria-hidden="true" />
      {label}
    </span>
  );
}
