"use client";

import { ClipboardList, List, MessageCircle } from "lucide-react";
import { useAccount } from "wagmi";

import { Button } from "@/components/ui/button";
import type { PassportStatus } from "@/components/ui/passport-status-badge";
import { usePassportOnChainOwner } from "@/hooks/use-passport-on-chain-owner";
import { useDisplayCurrency } from "@/lib/marketplace/display-currency-context";
import { normalizeListingFiatCurrency } from "@/lib/marketplace/price-normalize";
import {
  isOnChainNftOwner,
  resolveEffectiveOnChainOwner,
} from "@/lib/passport/passport-owner";
import type { PassportPanel } from "@/lib/passport/passport-panel-url";
import { cn } from "@/lib/utils";

type ListingPrice = {
  active: boolean;
  fiatPrice1e8: string;
  fiatCurrency: number;
};

type Props = {
  status: PassportStatus;
  passportOwner: `0x${string}`;
  chainId: number;
  tokenId: string;
  listing?: ListingPrice | null;
  commentCount: number | null;
  panelOpen: boolean;
  onOpenPanel: (panel: PassportPanel) => void;
};

function NavDot({ tone }: { tone: "warm" | "error" }) {
  return (
    <span
      className={cn(
        "absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full",
        tone === "warm" ? "bg-accent-warm" : "bg-status-error",
      )}
      aria-hidden
    />
  );
}

function CommentCountBadge({ count }: { count: number | null }) {
  if (count == null) {
    return (
      <span
        className="absolute -right-1 -top-1 h-3.5 w-3.5 animate-pulse rounded-full bg-bg-surface"
        aria-hidden
      />
    );
  }
  if (count <= 0) return null;
  return (
    <span
      className="absolute -right-1.5 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent-warm px-1 font-mono text-[9px] tabular-nums text-bg-primary"
      aria-label={`${count} comments`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

const iconButtonClass = cn(
  "relative flex h-11 w-11 items-center justify-center rounded-md border border-border-default",
  "text-text-primary transition-colors hover:border-border-hover hover:bg-bg-surface",
  "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
);

export function PassportActionBar({
  status,
  passportOwner,
  chainId,
  tokenId,
  listing,
  commentCount,
  panelOpen,
  onOpenPanel,
}: Props) {
  const { address } = useAccount();
  const { onChainOwner } = usePassportOnChainOwner(chainId, tokenId);
  const { convertPrice } = useDisplayCurrency();
  const effectiveOwner = resolveEffectiveOnChainOwner(onChainOwner, passportOwner);
  const isOwner = isOnChainNftOwner(address, effectiveOwner);

  const isDisputed = status === "DISPUTED";
  const showActionsDot = isDisputed && isOwner;
  const listingActive = Boolean(listing?.active);
  const priceLabel =
    listingActive && listing
      ? convertPrice(
          BigInt(listing.fiatPrice1e8),
          normalizeListingFiatCurrency(listing.fiatCurrency),
        )
      : null;

  if (panelOpen) return null;

  return (
    <div
      className={cn(
        "fixed inset-x-0 z-40 border-t border-border-default bg-bg-card",
        "bottom-16 pb-[env(safe-area-inset-bottom)] md:bottom-0",
      )}
      role="toolbar"
      aria-label="Passport actions"
    >
      <div className="mx-auto flex h-[4.5rem] max-w-7xl items-center gap-2.5 px-4 md:px-8 xl:max-w-[80rem]">
        <div className="min-w-0 shrink-0">
          {priceLabel ? (
            <>
              <p className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-text-tertiary">
                Price
              </p>
              <p className="truncate font-mono text-base font-medium tabular-nums text-text-primary md:text-lg">
                {priceLabel}
              </p>
            </>
          ) : (
            <p className="font-mono text-xs text-text-tertiary">Not listed</p>
          )}
        </div>

        {listingActive ? (
          <Button
            type="button"
            className="min-w-0 flex-1"
            onClick={() => onOpenPanel("commerce")}
          >
            Buy now
          </Button>
        ) : (
          <Button
            type="button"
            variant="secondary"
            className="min-w-0 flex-1"
            onClick={() => onOpenPanel("actions")}
          >
            Actions
          </Button>
        )}

        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={() => onOpenPanel("records")}
            aria-label="History and records"
            className={iconButtonClass}
          >
            <ClipboardList size={18} strokeWidth={1.5} aria-hidden />
            {isDisputed ? <NavDot tone="warm" /> : null}
          </button>
          <button
            type="button"
            onClick={() => onOpenPanel("actions")}
            aria-label="Actions"
            className={iconButtonClass}
          >
            <List size={18} strokeWidth={1.5} aria-hidden />
            {showActionsDot ? <NavDot tone="error" /> : null}
          </button>
          <button
            type="button"
            onClick={() => onOpenPanel("comments")}
            aria-label="Discussion"
            className={iconButtonClass}
          >
            <MessageCircle size={18} strokeWidth={1.5} aria-hidden />
            <CommentCountBadge count={commentCount} />
          </button>
        </div>
      </div>
    </div>
  );
}
