import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Shared empty-state UI for content-empty and infrastructure-empty cases.
 *
 * Wallet connect: do not bake WalletLoginButton into this component — render it
 * as a sibling after EmptyState, e.g.:
 *
 *   <div className="space-y-3">
 *     <EmptyState variant="infrastructure" level="B" title="Connect your wallet to …" />
 *     <WalletLoginButton />
 *   </div>
 */
export type EmptyStateVariant = "content" | "infrastructure";

export type EmptyStateAction = {
  label: string;
  href?: string;
  onClick?: () => void;
};

export type EmptyStateProps = {
  variant: EmptyStateVariant;
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: EmptyStateAction;
  level: "A" | "B";
  className?: string;
  children?: ReactNode;
  /** Defaults to "status" for infrastructure; use "alert" for indexer/ponder failures. */
  role?: "status" | "alert";
};

const actionClassName =
  "inline-flex min-h-11 items-center text-sm text-accent-warm transition-colors duration-150 hover:text-text-primary focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]";

function EmptyStateActionControl({ action }: { action: EmptyStateAction }) {
  if (action.href) {
    return (
      <Link href={action.href} className={actionClassName}>
        {action.label}
      </Link>
    );
  }

  return (
    <button type="button" className={actionClassName} onClick={action.onClick}>
      {action.label}
    </button>
  );
}

export function EmptyState({
  variant,
  icon: Icon,
  title,
  description,
  action,
  level,
  className,
  children,
  role,
}: EmptyStateProps) {
  const iconSize = level === "A" ? 48 : 32;
  const resolvedRole = role ?? (variant === "infrastructure" ? "status" : undefined);

  if (variant === "infrastructure") {
    return (
      <div
        className={cn(
          "space-y-3 rounded-md border border-border-default bg-bg-surface p-4",
          className,
        )}
        role={resolvedRole}
      >
        {Icon ? (
          <Icon
            size={32}
            strokeWidth={1.5}
            className="text-text-tertiary"
            aria-hidden
          />
        ) : null}
        <p className="font-sans text-sm text-text-secondary">{title}</p>
        {description ? (
          <p className="font-sans text-sm text-text-secondary">{description}</p>
        ) : null}
        {action ? <EmptyStateActionControl action={action} /> : null}
        {children ? <div className="mt-2">{children}</div> : null}
      </div>
    );
  }

  return (
    <div
      className={cn(
        level === "A" && "py-8 text-center",
        level === "B" && "text-center",
        className,
      )}
    >
      {Icon ? (
        <Icon
          size={iconSize}
          strokeWidth={1.5}
          className={cn("mx-auto text-text-tertiary", level === "B" && "mb-3")}
          aria-hidden
        />
      ) : null}
      {level === "A" ? (
        <h2 className="mt-4 font-display text-fluid-h2 font-medium text-text-primary">{title}</h2>
      ) : (
        <p className="text-sm font-medium text-text-primary">{title}</p>
      )}
      {description ? (
        <p
          className={cn(
            "font-sans text-sm text-text-secondary",
            level === "A" && "mx-auto mt-2 max-w-sm",
          )}
        >
          {description}
        </p>
      ) : null}
      {action ? (
        <div className={cn(level === "A" && "mt-4")}>
          <EmptyStateActionControl action={action} />
        </div>
      ) : null}
      {children ? <div className="mt-2">{children}</div> : null}
    </div>
  );
}
