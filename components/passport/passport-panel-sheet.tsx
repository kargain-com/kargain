"use client";

import { X } from "lucide-react";
import type { ReactNode } from "react";

import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  title: string;
  sectionId: string;
  dirty?: boolean;
  busy?: boolean;
  onOpen: () => void;
  onClose: () => void;
  children: ReactNode;
};

function requestClose({
  busy,
  dirty,
  onClose,
}: {
  busy: boolean;
  dirty: boolean;
  onClose: () => void;
}) {
  if (busy) return;
  if (dirty && !window.confirm("Discard unsaved changes?")) return;
  onClose();
}

/**
 * Prototype-style bottom sheet chrome (handle, sans title, bordered close)
 * with Instrument Layer content inside.
 */
export function PassportPanelSheet({
  open,
  title,
  sectionId,
  dirty = false,
  busy = false,
  onOpen,
  onClose,
  children,
}: Props) {
  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          onOpen();
          return;
        }
        requestClose({ busy, dirty, onClose });
      }}
    >
      <SheetContent
        side="bottom"
        forceMount
        hideClose
        className={cn(
          "z-[60] inset-x-0 mx-auto max-h-[78dvh] w-full max-w-3xl gap-0 rounded-t-[20px] border border-border-default border-b-0 p-0",
        )}
      >
        <div className="flex shrink-0 flex-col px-5 pb-2 pt-2.5">
          <div
            className="mx-auto mb-4 h-1 w-9 rounded-full bg-border-hover"
            aria-hidden
          />
          <div className="mb-4 flex items-center justify-between gap-3">
            <SheetTitle className="sr-only">{title}</SheetTitle>
            <h2 className="font-sans text-lg font-medium tracking-tight text-text-primary">
              {title}
            </h2>
            <SheetClose
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border-default",
                "text-text-secondary transition-colors hover:text-text-primary",
                "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
              )}
              aria-label="Close"
            >
              <X className="h-4 w-4" strokeWidth={1.5} />
            </SheetClose>
          </div>
        </div>
        <div
          id={sectionId}
          className="min-h-0 flex-1 overflow-y-auto px-5 pb-7"
        >
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}
