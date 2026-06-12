import * as React from "react";

import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        "w-full min-h-11 px-4 py-3 rounded-sm bg-bg-card border border-border-default font-sans text-base text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-warm focus:bg-bg-surface focus-visible:shadow-[var(--focus-ring)] transition-colors duration-200 ease-[var(--ease-out-smooth)] disabled:cursor-not-allowed disabled:opacity-50 file:border-0 file:bg-transparent file:text-sm file:font-medium",
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export { Input };
