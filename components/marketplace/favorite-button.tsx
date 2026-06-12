"use client";

import { Heart, Loader2 } from "lucide-react";
import { useState } from "react";
import { useAccount } from "wagmi";

import { Button } from "@/components/ui/button";
import { useFavorites } from "@/hooks/use-favorites";
import { DEFAULT_CHAIN_ID } from "@/lib/web3/supported-chains";
import { cn } from "@/lib/utils";

export function FavoriteButton({ tokenId, chainId = DEFAULT_CHAIN_ID }: { tokenId: string; chainId?: number }) {
  const { isConnected } = useAccount();
  const { isFavorite, addFavorite, removeFavorite, isSaving } = useFavorites();
  const [connectHint, setConnectHint] = useState(false);
  void chainId;

  const saved = isFavorite(tokenId);

  const handleClick = () => {
    if (!isConnected) {
      setConnectHint(true);
      return;
    }
    setConnectHint(false);
    if (saved) {
      void removeFavorite(tokenId);
    } else {
      void addFavorite(tokenId);
    }
  };

  if (!isConnected) {
    return (
      <div className="inline-flex flex-col items-start gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          title="Connect your wallet to save favorites"
          onClick={handleClick}
        >
          Save to garage
        </Button>
        {connectHint && (
          <p className="text-xs text-text-secondary" role="status">
            Connect your wallet to save favorites
          </p>
        )}
      </div>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="gap-2"
      onClick={handleClick}
      disabled={isSaving}
      aria-pressed={saved}
      aria-label={saved ? "Remove from garage" : "Save to garage"}
    >
      {isSaving ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <Heart
          className={cn("h-4 w-4", saved && "fill-accent-warm text-accent-warm")}
          aria-hidden
        />
      )}
      Garage
    </Button>
  );
}
