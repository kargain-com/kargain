"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useState } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { InstrumentFrame } from "@/components/ui/instrument-frame";
import { resolveUri } from "@/lib/storage/resolve-uri";
import { cn } from "@/lib/utils";

type Props = {
  photos: string[];
  chainId: number;
  verified?: boolean;
};

export function PassportPhotoGallery({ photos, chainId, verified = false }: Props) {
  const [selected, setSelected] = useState(0);
  const urls = photos.map((uri) => resolveUri(uri, chainId));

  const goPrev = useCallback(() => {
    setSelected((i) => (i <= 0 ? urls.length - 1 : i - 1));
  }, [urls.length]);

  const goNext = useCallback(() => {
    setSelected((i) => (i >= urls.length - 1 ? 0 : i + 1));
  }, [urls.length]);

  if (urls.length === 0) {
    return (
      <div className="flex aspect-[4/3] items-center justify-center rounded-md border border-border-default bg-bg-surface">
        <EmptyState variant="content" level="B" title="No photos" />
      </div>
    );
  }

  const mainUrl = urls[selected] ?? urls[0];

  return (
    <div className="space-y-3">
      <InstrumentFrame verified={verified}>
        <div className="relative aspect-[4/3] overflow-hidden bg-bg-surface">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={mainUrl}
          alt=""
          className="h-full w-full object-cover"
        />
        {urls.length > 1 && (
          <>
            <button
              type="button"
              onClick={goPrev}
              className="absolute left-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-sm border border-border-default bg-bg-primary/90 text-text-primary transition-colors hover:bg-bg-primary focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
              aria-label="Previous image"
            >
              <ChevronLeft size={20} strokeWidth={1.5} aria-hidden />
            </button>
            <button
              type="button"
              onClick={goNext}
              className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-sm border border-border-default bg-bg-primary/90 text-text-primary transition-colors hover:bg-bg-primary focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
              aria-label="Next image"
            >
              <ChevronRight size={20} strokeWidth={1.5} aria-hidden />
            </button>
          </>
        )}
        </div>
      </InstrumentFrame>

      {urls.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {urls.map((url, index) => (
            <button
              key={`${url}-${index}`}
              type="button"
              onClick={() => setSelected(index)}
              className={cn(
                "relative h-16 w-16 shrink-0 overflow-hidden rounded-sm border bg-bg-surface transition-colors focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
                index === selected
                  ? "border-accent-warm"
                  : "border-border-default hover:border-border-hover",
              )}
              aria-label={`Photo ${index + 1}`}
              aria-current={index === selected ? "true" : undefined}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
