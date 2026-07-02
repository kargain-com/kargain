/**
 * Vertical log axis with tick marks (design-spec §12.4).
 * IL-2 will refactor passport-log-section LogList to use this primitive.
 */
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type TimelineProps = {
  children: ReactNode;
  className?: string;
};

type ItemProps = {
  children: ReactNode;
  tickLabel?: ReactNode;
  className?: string;
};

function InstrumentTimelineRoot({ children, className }: TimelineProps) {
  return (
    <div className={cn("border-l border-border-default pl-4", className)}>
      <ul className="space-y-3">{children}</ul>
    </div>
  );
}

function InstrumentTimelineItem({ children, tickLabel, className }: ItemProps) {
  return (
    <li className={cn("relative", className)}>
      <div
        aria-hidden
        className="absolute -left-4 top-[0.65rem] flex w-4 items-center"
      >
        <span className="w-2 border-t border-border-default" />
      </div>
      {tickLabel ? (
        <div className="mb-1 font-mono text-xs tabular-nums text-text-tertiary">
          {tickLabel}
        </div>
      ) : null}
      {children}
    </li>
  );
}

export const InstrumentTimeline = Object.assign(InstrumentTimelineRoot, {
  Item: InstrumentTimelineItem,
});
