import type { IconComponent } from "@/components/ui/icons";
import Link from "next/link";
import type { ReactNode } from "react";

import { ctaLink } from "@/lib/design/instrument-classes";
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
  icon?: IconComponent;
  title: string;
  description?: string;
  action?: EmptyStateAction;
  level: "A" | "B";
  /**
   * Layout/spacing only (margin, max-width, alignment). Never use to remove the
   * fixed infrastructure panel — use `nested` instead.
   */
  className?: string;
  children?: ReactNode;
  /** Defaults to "status" for infrastructure; use "alert" for indexer/ponder failures. */
  role?: "status" | "alert";
  /**
   * Infrastructure only: when the caller already provides a Level B bordered shell,
   * render typography only (no panel chrome). Ignored when `variant="content"`.
   */
  nested?: boolean;
};

const actionClassName = ctaLink;

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

type InfrastructureBodyProps = {
  icon?: IconComponent;
  title: string;
  description?: string;
  action?: EmptyStateAction;
  children?: ReactNode;
};

function InfrastructureBody({ icon: Icon, title, description, action, children }: InfrastructureBodyProps) {
  return (
    <>
      {Icon ? (
        <Icon size={32} className="text-text-tertiary" aria-hidden />
      ) : null}
      <p className="font-sans text-sm text-text-secondary">{title}</p>
      {description ? (
        <p className="font-sans text-sm text-text-secondary">{description}</p>
      ) : null}
      {action ? <EmptyStateActionControl action={action} /> : null}
      {children ? <div className="mt-2">{children}</div> : null}
    </>
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
  nested = false,
}: EmptyStateProps) {
  const iconSize = level === "A" ? 48 : 32;
  const resolvedRole = role ?? (variant === "infrastructure" ? "status" : undefined);

  if (variant === "infrastructure") {
    if (nested) {
      return (
        <div className={cn("space-y-1", className)} role={resolvedRole}>
          <InfrastructureBody
            icon={Icon}
            title={title}
            description={description}
            action={action}
          >
            {children}
          </InfrastructureBody>
        </div>
      );
    }

    return (
      <div
        className={cn(
          "space-y-3 rounded-md border border-border-default bg-bg-surface p-4",
          className,
        )}
        role={resolvedRole}
      >
        <InfrastructureBody
          icon={Icon}
          title={title}
          description={description}
          action={action}
        >
          {children}
        </InfrastructureBody>
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
