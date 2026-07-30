import {
  commercePausedAnnouncementForMode,
  COMMERCE_PAUSED_ANNOUNCEMENT,
} from "@/lib/commerce/pause-surface";
import type { CommerceMode } from "@/lib/commerce/mode";
import { cn } from "@/lib/utils";

type Props = {
  /** When set, use the mode-specific announcement; otherwise the canonical line. */
  mode?: CommerceMode;
  className?: string;
};

/**
 * Informational pause chrome (§10.3): border-border-default / text-text-secondary.
 * Not accent-warm (not verified trust) and not status-error (not a dispute).
 */
export function CommercePausedNotice({ mode, className }: Props) {
  const copy =
    mode != null
      ? commercePausedAnnouncementForMode(mode)
      : COMMERCE_PAUSED_ANNOUNCEMENT;
  return (
    <div
      role="status"
      className={cn(
        "rounded-md border border-border-default bg-bg-surface p-4 text-sm text-text-secondary",
        className,
      )}
    >
      {copy}
    </div>
  );
}
