"use client";

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
} from "@/components/ui/icons";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type TouchEvent,
} from "react";

import { ContentImage } from "@/components/media/content-image";
import { EmptyState } from "@/components/ui/empty-state";
import { InstrumentFrame } from "@/components/ui/instrument-frame";
import { resolveUri } from "@/lib/storage/resolve-uri";
import { cn } from "@/lib/utils";

const SWIPE_THRESHOLD_PX = 40;

type Props = {
  photos: string[];
  chainId: number;
  verified?: boolean;
};

function useSwipeNavigation(goPrev: () => void, goNext: () => void) {
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const isHorizontalSwipe = useRef(false);

  const onTouchStart = useCallback((e: TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
    touchStartY.current = e.touches[0]?.clientY ?? null;
    isHorizontalSwipe.current = false;
  }, []);

  const onTouchMove = useCallback((e: TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const dx = Math.abs((e.touches[0]?.clientX ?? 0) - touchStartX.current);
    const dy = Math.abs((e.touches[0]?.clientY ?? 0) - touchStartY.current);
    if (dx > dy && dx > 10) {
      isHorizontalSwipe.current = true;
      e.preventDefault();
    }
  }, []);

  const onTouchEnd = useCallback(
    (e: TouchEvent) => {
      if (touchStartX.current === null) return;
      const endX = e.changedTouches[0]?.clientX ?? touchStartX.current;
      const deltaX = endX - touchStartX.current;
      if (isHorizontalSwipe.current && Math.abs(deltaX) > SWIPE_THRESHOLD_PX) {
        if (deltaX > 0) goPrev();
        else goNext();
      }
      touchStartX.current = null;
      touchStartY.current = null;
      isHorizontalSwipe.current = false;
    },
    [goPrev, goNext],
  );

  return { onTouchStart, onTouchMove, onTouchEnd };
}

type GalleryNavButtonProps = {
  direction: "prev" | "next";
  onClick: () => void;
  className?: string;
};

function GalleryNavButton({ direction, onClick, className }: GalleryNavButtonProps) {
  const Icon = direction === "prev" ? ChevronLeftIcon : ChevronRightIcon;
  const label = direction === "prev" ? "Previous image" : "Next image";

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-11 w-11 items-center justify-center rounded-sm border border-border-default bg-bg-primary/90 text-text-primary transition-colors hover:bg-bg-primary focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] md:h-9 md:w-9",
        className,
      )}
      aria-label={label}
    >
      <Icon size={20} aria-hidden />
    </button>
  );
}

function PhotoCounter({
  index,
  total,
  className,
}: {
  index: number;
  total: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "rounded-sm bg-bg-primary/65 px-2 py-0.5 font-mono text-xs tabular-nums text-text-primary",
        className,
      )}
    >
      {index + 1} / {total}
    </span>
  );
}

function PhotoDots({
  total,
  selected,
  onSelect,
}: {
  total: number;
  selected: number;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="flex gap-1.5" role="tablist" aria-label="Photo navigation">
      {Array.from({ length: total }, (_, index) => (
        <button
          key={index}
          type="button"
          role="tab"
          aria-selected={index === selected}
          aria-label={`Photo ${index + 1}`}
          onClick={() => onSelect(index)}
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full border-0 p-0 transition-colors focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
            index === selected ? "bg-accent-warm" : "bg-text-tertiary/50",
          )}
        />
      ))}
    </div>
  );
}

/**
 * Shared gallery enhancements (handoff): swipe, counter/dots, fullscreen lightbox.
 * Applies on all breakpoints; mobile quick-nav/sheets remain separate.
 */
export function PassportPhotoGallery({ photos, chainId, verified = false }: Props) {
  const [selected, setSelected] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const heroButtonRef = useRef<HTMLButtonElement>(null);
  const urls = photos.map((uri) => resolveUri(uri, chainId));

  const goPrev = useCallback(() => {
    setSelected((i) => (i <= 0 ? urls.length - 1 : i - 1));
  }, [urls.length]);

  const goNext = useCallback(() => {
    setSelected((i) => (i >= urls.length - 1 ? 0 : i + 1));
  }, [urls.length]);

  const swipe = useSwipeNavigation(goPrev, goNext);

  const closeLightbox = useCallback(() => {
    setLightboxOpen(false);
    heroButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!lightboxOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        closeLightbox();
        return;
      }
      if (e.key === "ArrowLeft") goPrev();
      if (e.key === "ArrowRight") goNext();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [lightboxOpen, closeLightbox, goPrev, goNext]);

  if (urls.length === 0) {
    return (
      <div className="flex aspect-[4/3] w-full max-w-3xl items-center justify-center rounded-md border border-border-default bg-bg-surface md:aspect-[16/10] md:max-w-4xl">
        <EmptyState variant="content" level="B" title="No photos" />
      </div>
    );
  }

  const mainUrl = urls[selected] ?? urls[0];
  const hasMultiple = urls.length > 1;

  const openLightbox = () => setLightboxOpen(true);

  const onHeroKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openLightbox();
    }
  };

  return (
    <div className="w-full max-w-3xl space-y-3 md:max-w-4xl">
      <InstrumentFrame verified={verified}>
        <div
          className="relative aspect-[4/3] overflow-hidden bg-bg-surface md:aspect-[16/10]"
          onTouchStart={hasMultiple ? swipe.onTouchStart : undefined}
          onTouchMove={hasMultiple ? swipe.onTouchMove : undefined}
          onTouchEnd={hasMultiple ? swipe.onTouchEnd : undefined}
        >
          <button
            ref={heroButtonRef}
            type="button"
            onClick={openLightbox}
            onKeyDown={onHeroKeyDown}
            className="relative block h-full w-full cursor-zoom-in border-0 bg-transparent p-0 focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
            aria-label="View full screen"
          >
            <ContentImage
              src={mainUrl}
              alt=""
              sizes="(max-width: 768px) 100vw, 56rem"
              priority
            />
          </button>

          {hasMultiple && (
            <>
              <GalleryNavButton
                direction="prev"
                onClick={goPrev}
                className="absolute left-2 top-1/2 -translate-y-1/2"
              />
              <GalleryNavButton
                direction="next"
                onClick={goNext}
                className="absolute right-2 top-1/2 -translate-y-1/2"
              />
              <div className="pointer-events-none absolute inset-x-0 bottom-2 flex items-center justify-between px-2">
                <div className="pointer-events-auto">
                  <PhotoDots total={urls.length} selected={selected} onSelect={setSelected} />
                </div>
                <PhotoCounter index={selected} total={urls.length} />
              </div>
            </>
          )}
        </div>
      </InstrumentFrame>

      {hasMultiple && (
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
              <ContentImage src={url} alt="" sizes="64px" />
            </button>
          ))}
        </div>
      )}

      {lightboxOpen && (
        <div
          className="fixed inset-0 z-[60] flex flex-col bg-black"
          role="dialog"
          aria-modal="true"
          aria-label="Full screen photo viewer"
        >
          <div className="flex shrink-0 items-center justify-between px-5 py-4">
            <PhotoCounter
              index={selected}
              total={urls.length}
              className="bg-bg-primary/20 text-text-secondary"
            />
            <button
              type="button"
              onClick={closeLightbox}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-border-default text-text-primary transition-colors hover:bg-bg-primary/10 focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
              aria-label="Close full screen photo"
            >
              <CloseIcon size={20} aria-hidden />
            </button>
          </div>

          <div
            className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-4"
            onTouchStart={hasMultiple ? swipe.onTouchStart : undefined}
            onTouchMove={hasMultiple ? swipe.onTouchMove : undefined}
            onTouchEnd={hasMultiple ? swipe.onTouchEnd : undefined}
          >
            <div className="relative h-full w-full min-h-[50vh]">
              <ContentImage
                src={mainUrl}
                alt=""
                sizes="100vw"
                fit="contain"
                priority
              />
            </div>
            {hasMultiple && (
              <>
                <GalleryNavButton
                  direction="prev"
                  onClick={goPrev}
                  className="absolute left-4 top-1/2 -translate-y-1/2 border-border-hover bg-bg-primary/60"
                />
                <GalleryNavButton
                  direction="next"
                  onClick={goNext}
                  className="absolute right-4 top-1/2 -translate-y-1/2 border-border-hover bg-bg-primary/60"
                />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
