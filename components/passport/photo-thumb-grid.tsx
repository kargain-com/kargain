"use client";

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
} from "@/components/ui/icons";

import { cn } from "@/lib/utils";

export type PhotoThumbItem = {
  id: string;
  src: string;
  alt: string;
};

type PhotoThumbGridProps = {
  items: PhotoThumbItem[];
  disabled?: boolean;
  onRemove: (index: number) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  className?: string;
};

export function PhotoThumbGrid({
  items,
  disabled,
  onRemove,
  onReorder,
  className,
}: PhotoThumbGridProps) {
  if (items.length === 0) return null;

  return (
    <div className={cn("grid grid-cols-2 gap-3 sm:grid-cols-3", className)}>
      {items.map((item, index) => (
        <div
          key={item.id}
          className="relative aspect-square overflow-hidden rounded-md border border-border-default bg-bg-surface"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.src}
            alt={item.alt}
            className="h-full w-full object-cover"
          />

          {index === 0 && (
            <span className="absolute left-1.5 top-1.5 rounded-sm bg-bg-primary/80 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-text-secondary">
              Cover
            </span>
          )}

          {!disabled && (
            <>
              <button
                type="button"
                className="absolute right-1.5 top-1.5 rounded-sm bg-bg-primary/80 p-1 transition-colors hover:bg-bg-primary"
                onClick={() => onRemove(index)}
                aria-label="Remove photo"
              >
                <CloseIcon size={14} aria-hidden />
              </button>

              <div className="absolute inset-x-0 bottom-0 flex justify-center gap-1 bg-gradient-to-t from-bg-primary/90 to-transparent p-1.5 pt-4">
                <button
                  type="button"
                  className="rounded-sm bg-bg-primary/80 p-1 transition-colors hover:bg-bg-primary disabled:opacity-40"
                  disabled={index === 0}
                  onClick={() => onReorder(index, index - 1)}
                  aria-label="Move photo earlier"
                >
                  <ChevronLeftIcon size={14} aria-hidden />
                </button>
                <button
                  type="button"
                  className="rounded-sm bg-bg-primary/80 p-1 transition-colors hover:bg-bg-primary disabled:opacity-40"
                  disabled={index === items.length - 1}
                  onClick={() => onReorder(index, index + 1)}
                  aria-label="Move photo later"
                >
                  <ChevronRightIcon size={14} aria-hidden />
                </button>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
