"use client";

import { BookmarkCheckIcon, BookmarkIcon, SpinnerIcon } from "@/components/ui/icons";
import { useAccount } from "wagmi";

import { Button } from "@/components/ui/button";
import { useWatchlist } from "@/hooks/use-watchlist";
import { cn } from "@/lib/utils";

type Props = {
  tokenId: string;
};

export function WatchlistButton({ tokenId }: Props) {
  const { isConnected } = useAccount();
  const { isWatched, isToggling, toggle } = useWatchlist(tokenId);

  const disabled = !isConnected || isToggling;
  const watching = isConnected && isWatched;
  const label = watching ? "Watching" : "Watch";

  return (
    <Button
      type="button"
      variant="secondary"
      className={cn("w-full", watching && "text-accent-warm hover:text-accent-warm")}
      disabled={disabled}
      aria-busy={isToggling}
      onClick={() => void toggle()}
    >
      {isToggling ? (
        <SpinnerIcon size={16} className="animate-spin opacity-60" aria-hidden />
      ) : watching ? (
        <BookmarkCheckIcon size={16} className="text-accent-warm" aria-hidden />
      ) : (
        <BookmarkIcon size={16} aria-hidden />
      )}
      {label}
    </Button>
  );
}
