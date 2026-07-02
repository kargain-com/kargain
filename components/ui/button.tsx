import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { shellControlHover } from "@/lib/design/instrument-classes";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 min-h-11 whitespace-nowrap rounded-sm font-sans text-sm font-medium transition-colors duration-200 ease-[cubic-bezier(0.33,1,0.68,1)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-white text-bg-primary hover:bg-text-secondary hover:text-bg-primary",
        secondary: cn(
          "border border-border-hover bg-transparent text-text-primary",
          shellControlHover,
        ),
        ghost: "bg-transparent text-text-primary hover:bg-bg-surface",
        default: "bg-white text-bg-primary hover:bg-text-secondary hover:text-bg-primary",
        outline: cn(
          "border border-border-hover bg-transparent text-text-primary",
          shellControlHover,
        ),
      },
      size: {
        default: "px-7 py-3.5",
        sm: "px-4 py-2 min-h-11 text-xs",
        md: "px-7 py-3.5",
        lg: "px-9 py-4 min-h-12 text-base",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
