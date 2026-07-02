"use client";

import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";

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
  emptyBehavior: "copy" | "hide";
  emptyMessage?: string;
  expandBehavior: "always" | "collapsible";
  className?: string;
};

function LogList<T>({
  items,
  getItemKey,
  getItemBorder,
  renderItem,
}: Pick<
  PassportLogSectionProps<T>,
  "items" | "getItemKey" | "getItemBorder" | "renderItem"
>) {
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li
          key={getItemKey(item)}
          className={cn(
            "rounded-md border bg-bg-primary/80 p-4",
            ITEM_BORDER_CLASS[getItemBorder(item)],
          )}
        >
          {renderItem(item)}
        </li>
      ))}
    </ul>
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
        <p className="font-sans text-sm text-text-secondary">{emptyMessage}</p>
      ) : (
        <LogList
          items={items}
          getItemKey={getItemKey}
          getItemBorder={getItemBorder}
          renderItem={renderItem}
        />
      )}
    </section>
  );
}
