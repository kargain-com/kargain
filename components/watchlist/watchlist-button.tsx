"use client";

import { Bookmark, BookmarkCheck, Loader2 } from "lucide-react";
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
        <Loader2 size={16} strokeWidth={1.5} className="animate-spin opacity-60" aria-hidden />
      ) : watching ? (
        <BookmarkCheck size={16} strokeWidth={1.5} className="text-accent-warm" aria-hidden />
      ) : (
        <Bookmark size={16} strokeWidth={1.5} aria-hidden />
      )}
      {label}
    </Button>
  );
}
