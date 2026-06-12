import * as React from "react";

import { cn } from "@/lib/utils";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      className={cn(
        "w-full min-h-[7.5rem] max-h-[24rem] resize-y px-4 py-3 rounded-sm bg-bg-card border border-border-default font-sans text-base text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-warm focus:bg-bg-surface focus-visible:shadow-[var(--focus-ring)] transition-colors duration-200 ease-[var(--ease-out-smooth)] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";

export { Textarea };
