"use client";

import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { InstrumentTimeline } from "@/components/ui/instrument-timeline";
import { cn } from "@/lib/utils";

export type PassportLogItemBorder = "default" | "verified" | "error";

const ITEM_BORDER_CLASS: Record<PassportLogItemBorder, string> = {
  default: "border-border-default",
  verified: "border-accent-warm",
  error: "border-status-error/40",
};

export type PassportLogSectionProps<T> = {
  title: string;
  sectionId?: string;
  headerMeta?: ReactNode;
  items: T[];
  renderItem: (item: T) => ReactNode;
  getItemKey: (item: T) => string;
  getItemBorder: (item: T) => PassportLogItemBorder;
  getItemTickLabel?: (item: T) => ReactNode;
  emptyBehavior: "copy" | "hide";
  emptyMessage?: string;
  expandBehavior: "always" | "collapsible";
  className?: string;
};

function LogList<T>({
  items,
  getItemKey,
  getItemBorder,
  getItemTickLabel,
  renderItem,
}: Pick<
  PassportLogSectionProps<T>,
  "items" | "getItemKey" | "getItemBorder" | "getItemTickLabel" | "renderItem"
>) {
  return (
    <InstrumentTimeline>
      {items.map((item) => (
        <InstrumentTimeline.Item
          key={getItemKey(item)}
          tickLabel={getItemTickLabel?.(item)}
        >
          <div
            className={cn(
              "rounded-md border bg-bg-primary/80 p-4",
              ITEM_BORDER_CLASS[getItemBorder(item)],
            )}
          >
            {renderItem(item)}
          </div>
        </InstrumentTimeline.Item>
      ))}
    </InstrumentTimeline>
  );
}

export function PassportLogSection<T>({
  title,
  sectionId,
  headerMeta,
  items,
  renderItem,
  getItemKey,
  getItemBorder,
  getItemTickLabel,
  emptyBehavior,
  emptyMessage,
  expandBehavior,
  className,
}: PassportLogSectionProps<T>) {
  const [expanded, setExpanded] = useState(false);

  if (items.length === 0 && emptyBehavior === "hide") {
    return null;
  }

  if (expandBehavior === "collapsible") {
    return (
      <section
        className={cn("rounded-md border border-border-default bg-bg-surface", className)}
      >
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-between px-6 py-4 text-left"
          aria-expanded={expanded}
        >
          <span className="font-sans text-sm font-medium text-text-primary">
            {title}
            {headerMeta}
          </span>
          <ChevronDown
            size={16}
            strokeWidth={1.5}
            aria-hidden
            className={cn(
              "text-text-secondary transition-transform duration-200",
              expanded && "rotate-180",
            )}
          />
        </button>

        {expanded && (
          <div className="border-t border-border-default px-6 pb-6 pt-4">
            <LogList
              items={items}
              getItemKey={getItemKey}
              getItemBorder={getItemBorder}
              getItemTickLabel={getItemTickLabel}
              renderItem={renderItem}
            />
          </div>
        )}
      </section>
    );
  }

  return (
    <section
      id={sectionId}
      className={cn(
        "space-y-4 rounded-md border border-border-default bg-bg-surface p-6",
        className,
      )}
    >
      <h2 className="font-display text-fluid-h2 font-medium tracking-[-0.015em] text-text-primary">
        {title}
      </h2>
      {items.length === 0 ? (
        <EmptyState variant="content" level="B" title={emptyMessage ?? ""} />
      ) : (
        <LogList
          items={items}
          getItemKey={getItemKey}
          getItemBorder={getItemBorder}
          getItemTickLabel={getItemTickLabel}
          renderItem={renderItem}
        />
      )}
    </section>
  );
}
