"use client";

import { useQuery } from "@tanstack/react-query";

import {
  searchActiveAuctions,
  type AuctionBrowseResult,
} from "@/app/actions/auction-browse";
import { AuctionCard } from "@/components/auction/auction-card";
import { EmptyState } from "@/components/ui/empty-state";
import { useNow } from "@/hooks/use-now";
import { LISTING_CARD_GRID_WIDE } from "@/lib/marketplace/listing-card-grid";
import { MARKETPLACE_SHELL_CONTAINER } from "@/lib/marketplace/listing-card-grid";
import { cn } from "@/lib/utils";

type Props = {
  initialPage?: AuctionBrowseResult;
  chainId: number | null;
};

export function AuctionBrowse({ initialPage, chainId }: Props) {
  // One shared minute ticker for all cards (blueprint §5)
  const now = useNow(60_000);

  const { data, isPending } = useQuery({
    queryKey: ["auction-browse", chainId],
    queryFn: () =>
      searchActiveAuctions({ chainId: chainId ?? undefined, limit: 48 }),
    initialData: initialPage,
    staleTime: 30_000,
  });

  const rows = data?.rows ?? [];
  const ponderError = data?.ponderError;

  if (ponderError === "PONDER_UNAVAILABLE" && rows.length === 0) {
    return (
      <div className={MARKETPLACE_SHELL_CONTAINER}>
        <EmptyState
          variant="infrastructure"
          level="B"
          title="Auctions unavailable"
          description="Auction data could not be loaded right now. Try again in a moment."
        />
      </div>
    );
  }

  if (!isPending && rows.length === 0) {
    return (
      <div className={MARKETPLACE_SHELL_CONTAINER}>
        <EmptyState
          variant="content"
          level="B"
          title="No active auctions"
          description="When professional sellers start auctions, they will show up here."
        />
      </div>
    );
  }

  return (
    <div className={cn(MARKETPLACE_SHELL_CONTAINER, "pb-16")}>
      <ul className={LISTING_CARD_GRID_WIDE}>
        {rows.map((row) => (
          <li key={row.tokenId} className="min-h-0">
            <AuctionCard row={row} now={now} />
          </li>
        ))}
      </ul>
    </div>
  );
}
