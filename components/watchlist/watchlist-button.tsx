"use client";

import { useActiveAccount, requireEvmSession } from "@/hooks/use-active-account";

import { BookmarkCheckIcon, BookmarkIcon, SpinnerIcon } from "@/components/ui/icons";

import { EvmSessionRefusal } from "@/components/shell/evm-session-refusal";
import { Button } from "@/components/ui/button";
import { useWatchlist } from "@/hooks/use-watchlist";
import { cn } from "@/lib/utils";

type Props = {
  tokenId: string;
};

export function WatchlistButton({ tokenId }: Props) {
  const { account } = useActiveAccount();
  const evm = requireEvmSession(account);
  const { isWatched, isToggling, toggle } = useWatchlist(tokenId);

  if (!evm.ok) {
    return (
      <EvmSessionRefusal
        cause={evm.cause}
        disconnectedTitle="Connect your wallet to save vehicles to your watchlist."
      />
    );
  }

  const watching = isWatched;
  const label = watching ? "Watching" : "Watch";

  return (
    <Button
      type="button"
      variant="secondary"
      className={cn("w-full", watching && "text-accent-warm hover:text-accent-warm")}
      disabled={isToggling}
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
