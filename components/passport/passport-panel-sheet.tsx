"use client";

import type { ReactNode } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
 * Centered modal (site-standard Dialog) for passport History / Actions / mobile Discussion.
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
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          onOpen();
          return;
        }
        requestClose({ busy, dirty, onClose });
      }}
    >
      <DialogContent
        forceMount
        showClose
        className={cn(
          "z-[60] flex max-h-[min(85dvh,40rem)] w-[calc(100%-2rem)] max-w-lg flex-col gap-0 overflow-hidden p-0 sm:max-w-xl",
        )}
      >
        <DialogHeader className="shrink-0 border-b border-border-default px-6 py-4 pr-12">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div
          id={sectionId}
          className="min-h-0 flex-1 overflow-y-auto px-6 py-4"
        >
          {children}
        </div>
      </DialogContent>
    </Dialog>
  );
}
