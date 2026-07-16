"use client";

import { useEffect, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

type Props = {
  /** When null/empty, renders reserved empty slot (no layout shift). */
  message: string | null;
  /** Auto-dismiss after ms; 0 = no auto-clear (parent clears). */
  clearAfterMs?: number;
  onClear?: () => void;
  className?: string;
  children?: ReactNode;
};

/**
 * Ephemeral status strip — outbid / similar notices.
 * role=status + aria-live=polite; neutral tokens only (no accent-warm).
 */
export function StatusToast({
  message,
  clearAfterMs = 8_000,
  onClear,
  className,
}: Props) {
  const [dismissedMessage, setDismissedMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!message || clearAfterMs <= 0) return;
    const id = window.setTimeout(() => {
      setDismissedMessage(message);
      onClear?.();
    }, clearAfterMs);
    return () => window.clearTimeout(id);
  }, [message, clearAfterMs, onClear]);

  const show = Boolean(message) && dismissedMessage !== message;

  if (!show) return null;

  return (
    <div
      className={cn("min-h-[2.75rem]", className)}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <p className="rounded-md border border-border-default bg-bg-surface px-3 py-2 font-sans text-sm text-text-secondary">
        {message}
      </p>
    </div>
  );
}
