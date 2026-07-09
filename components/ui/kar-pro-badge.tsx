import { UserCheckIcon } from "@/components/ui/icons";

import { trustStampBase, trustStampKarPro } from "@/lib/design/instrument-classes";
import { cn } from "@/lib/utils";

export function KarProBadge({ name, className }: { name?: string; className?: string }) {
  const label = name ? `verified · ${name}` : "verified pro";

  return (
    <span className={cn(trustStampBase, trustStampKarPro, className)}>
      <UserCheckIcon size={12} aria-hidden="true" />
      {label}
    </span>
  );
}
