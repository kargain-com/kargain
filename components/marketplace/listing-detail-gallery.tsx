"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "@/components/ui/icons";
import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

type Props = {
  urls: string[];
  prevLabel: string;
  nextLabel: string;
  altBase: string;
};

export function ListingDetailGallery({ urls, prevLabel, nextLabel, altBase }: Props) {
  const [i, setI] = useState(0);
  const safe = urls.length ? urls : [];
  const current = safe[i] ?? null;

  const go = useCallback(
    (d: number) => {
      if (!safe.length) return;
      setI((x) => (x + d + safe.length) % safe.length);
    },
    [safe.length],
  );

  if (!current) {
    return (
      <div className="flex aspect-[16/10] w-full items-center justify-center rounded-md border border-border-default bg-bg-surface text-sm text-text-secondary">
        <EmptyState variant="content" level="B" title="No images" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-md border border-border-default bg-bg-surface">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={current}
          alt={`${altBase} — ${i + 1} of ${safe.length}`}
          className="aspect-[16/10] w-full object-cover"
        />
        {safe.length > 1 && (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="absolute left-2 top-1/2 h-9 w-9 -translate-y-1/2 border border-border-hover bg-bg-primary/60 p-0 text-text-primary hover:bg-bg-primary/80"
              onClick={() => go(-1)}
              aria-label={prevLabel}
            >
              <ChevronLeftIcon size={16} className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="absolute right-2 top-1/2 h-9 w-9 -translate-y-1/2 border border-border-hover bg-bg-primary/60 p-0 text-text-primary hover:bg-bg-primary/80"
              onClick={() => go(1)}
              aria-label={nextLabel}
            >
              <ChevronRightIcon size={16} className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>
      {safe.length > 1 && (
        <ul className="flex gap-2 overflow-x-auto pb-1" role="list">
          {safe.map((u, idx) => (
            <li key={u} className="shrink-0">
              <button
                type="button"
                onClick={() => setI(idx)}
                className={cn(
                  "overflow-hidden rounded-md border-2 transition-colors",
                  idx === i ? "border-accent-warm" : "border-transparent opacity-70 hover:opacity-100",
                )}
                aria-label={`Show image ${idx + 1}`}
                aria-current={idx === i}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u} alt="" className="h-16 w-24 object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
