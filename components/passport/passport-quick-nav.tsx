"use client";

import { useAccount } from "wagmi";

import { usePassportOnChainOwner } from "@/hooks/use-passport-on-chain-owner";
import {
  isOnChainNftOwner,
  resolveEffectiveOnChainOwner,
} from "@/lib/passport/passport-owner";
import type { PassportStatus } from "@/components/ui/passport-status-badge";
import type { PassportPanel } from "@/lib/passport/passport-panel-url";
import { cn } from "@/lib/utils";

type QuickNavProps = {
  status: PassportStatus;
  passportOwner: `0x${string}`;
  chainId: number;
  tokenId: string;
  commentCount: number | null;
  onOpenPanel: (panel: PassportPanel) => void;
};

type NavLinkProps = {
  href: string;
  label: string;
  indicator?: React.ReactNode;
};

function QuickNavLink({ href, label, indicator }: NavLinkProps) {
  return (
    <a
      href={href}
      className={cn(
        "relative flex min-h-11 flex-col items-center justify-center gap-0.5 px-2",
        "font-sans text-[11px] leading-tight text-text-secondary transition-colors",
        "hover:text-text-primary focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
      )}
    >
      <span className="relative">
        {label}
        {indicator}
      </span>
    </a>
  );
}

function QuickNavButton({
  label,
  indicator,
  onClick,
}: {
  label: string;
  indicator?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex min-h-11 w-full flex-col items-center justify-center gap-0.5 px-2",
        "font-sans text-[11px] leading-tight text-text-secondary transition-colors",
        "hover:text-text-primary focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
      )}
    >
      <span className="relative">
        {label}
        {indicator}
      </span>
    </button>
  );
}

function NavDot({
  tone,
  className,
}: {
  tone: "warm" | "error";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "absolute -right-2 -top-1 h-1.5 w-1.5 rounded-full",
        tone === "warm" ? "bg-accent-warm" : "bg-status-error",
        className,
      )}
      aria-hidden
    />
  );
}

function CommentCountBadge({ count }: { count: number | null }) {
  if (count == null) {
    return (
      <span
        className="absolute -right-3 -top-2 h-3.5 w-3.5 animate-pulse rounded-full bg-bg-surface"
        aria-hidden
      />
    );
  }
  if (count <= 0) return null;
  return (
    <span
      className="absolute -right-3 -top-2 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent-warm px-1 font-mono text-[9px] tabular-nums text-bg-primary"
      aria-label={`${count} comments`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

export function PassportQuickNav({
  status,
  passportOwner,
  chainId,
  tokenId,
  commentCount,
  onOpenPanel,
}: QuickNavProps) {
  const { address } = useAccount();
  const { onChainOwner } = usePassportOnChainOwner(chainId, tokenId);
  const effectiveOwner = resolveEffectiveOnChainOwner(onChainOwner, passportOwner);
  const isOwner = isOnChainNftOwner(address, effectiveOwner);

  const isDisputed = status === "DISPUTED";
  const showActionsDot = isDisputed && isOwner;

  return (
    <nav
      className="fixed bottom-16 left-0 right-0 z-40 border-t border-border-default bg-bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
      aria-label="Passport section navigation"
    >
      <div className="mx-auto grid max-w-lg grid-cols-3">
        <QuickNavLink
          href="#passport-records"
          label="Records"
          indicator={isDisputed ? <NavDot tone="warm" /> : undefined}
        />
        <QuickNavButton
          label="Actions"
          indicator={showActionsDot ? <NavDot tone="error" /> : undefined}
          onClick={() => onOpenPanel("actions")}
        />
        <QuickNavButton
          label="Discussion"
          indicator={<CommentCountBadge count={commentCount} />}
          onClick={() => onOpenPanel("comments")}
        />
      </div>
    </nav>
  );
}
