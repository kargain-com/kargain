"use client";

import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useInView } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Address } from "viem";
import { useAccount, useReadContract, useReadContracts } from "wagmi";

import {
  getAgentAuthorizations,
  getAgentListings,
} from "@/app/actions/agent-consignment";
import {
  getAgentActiveAuctions,
  getAgentAuctionAuthorizations,
  type PonderAuctionAuthorizationRaw,
} from "@/app/actions/auction-agent";
import { fetchPassportBatch } from "@/app/actions/notifications";
import { AgentCreateAuctionPanel } from "@/components/auction/agent-create-auction-panel";
import { AuctionCancelPanel } from "@/components/auction/auction-cancel-panel";
import { ConsignmentPortfolioRow } from "@/components/consignment/consignment-portfolio-row";
import { AgentDelistButton } from "@/components/marketplace/agent-delist-button";
import { AgentListOnBehalfPanel } from "@/components/marketplace/agent-list-on-behalf-panel";
import { AgentUpdateListingPanel } from "@/components/marketplace/agent-update-listing-panel";
import { ListingCard } from "@/components/marketplace/listing-card";
import { ListingCardSkeleton } from "@/components/marketplace/listing-card-skeleton";
import { ReturnCooldownDisplay } from "@/components/marketplace/return-cooldown-display";
import { PassportIdLabel } from "@/components/passport/passport-id-label";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { PassportStatusBadge } from "@/components/ui/passport-status-badge";
import {
  deriveAuctionConsignment,
  deriveFixedPriceConsignment,
} from "@/lib/consignment/lifecycle";
import {
  auctionAuthToLifecycleInput,
  marketplaceAuthToLifecycleInput,
} from "@/lib/consignment/map-authorization";
import { formatAuctionAmount } from "@/lib/auction/format-auction";
import type { AuctionRow } from "@/lib/auction/map-ponder-auction";
import { auctionAssetLabelFromAddress } from "@/lib/auction/owner-min-asset";
import { categoryLabel, sansLinkUnderline } from "@/lib/design/instrument-classes";
import { LISTING_CARD_GRID_NARROW } from "@/lib/marketplace/listing-card-grid";
import { MarketplaceEscrowAbi } from "@/lib/contracts/abis.generated";
import {
  mapAgentListingToRow,
  type MarketplaceListingRow,
} from "@/lib/marketplace/map-ponder-listing";
import { parseMarketplaceAgentAuthorization } from "@/lib/marketplace/agent-authorization";
import { parseReturnRequestedAt } from "@/lib/marketplace/listing-agent";
import type {
  PassportStatus,
  PonderAgentAuthorization,
  PonderAgentListingRaw,
} from "@/lib/types/ponder";
import { marketplaceAddress } from "@/lib/web3/deployment-addresses";
import { wagmiChainId } from "@/lib/web3/supported-chains";
import { useNow } from "@/hooks/use-now";
import { cn } from "@/lib/utils";

type PassportEnrichment = {
  owner: string;
  make: string;
  model: string;
  year: number;
  status: PassportStatus;
};

type Props = {
  wallet: Address;
  chainId: number;
};

const LISTINGS_PAGE_SIZE = 20;

async function invalidateAgentConsignmentQueries(
  wallet: Address,
  queryClient: ReturnType<typeof useQueryClient>,
  router: ReturnType<typeof useRouter>,
) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["agent-awaiting", wallet] }),
    queryClient.invalidateQueries({ queryKey: ["agent-listings", wallet] }),
    queryClient.invalidateQueries({
      queryKey: ["agent-auction-awaiting", wallet],
    }),
    queryClient.invalidateQueries({
      queryKey: ["agent-auction-active", wallet],
    }),
  ]);
  router.refresh();
}

function AwaitingCardSkeleton() {
  return (
    <div className="rounded-md border border-border-default bg-bg-surface px-4 py-3">
      <div className="h-4 w-32 animate-pulse rounded bg-bg-card" />
      <div className="mt-2 h-4 w-48 animate-pulse rounded bg-bg-card" />
      <div className="mt-2 h-3 w-24 animate-pulse rounded bg-bg-card" />
    </div>
  );
}

function PonderErrorBanner({ message }: { message: string }) {
  return (
    <div
      className="rounded-md border border-border-default bg-bg-surface p-4 text-sm text-text-secondary"
      role="alert"
    >
      <p className="font-medium text-text-primary">{message}</p>
      <p className="mt-1">Start the Ponder indexer to load consignment data.</p>
      <code className="mt-2 inline-block rounded-sm bg-bg-card px-2 py-1 font-mono text-xs">
        pnpm ponder:dev
      </code>
    </div>
  );
}

function SectionHeading({ children }: { children: string }) {
  return <h3 className={cn(categoryLabel, "mb-3")}>{children}</h3>;
}

function AuthorizedAwaitingCard({
  tokenId,
  chainId,
  status,
  make,
  model,
  year,
  owner,
  chainStatusUnavailable,
  ownerMinPrice1e8,
  platformFeeBps,
  wallet,
  expiry,
  nowSec,
  onConsignmentChanged,
}: {
  tokenId: string;
  chainId: number;
  status: PassportStatus;
  make?: string;
  model?: string;
  year?: number;
  owner: string;
  chainStatusUnavailable?: boolean;
  ownerMinPrice1e8: bigint;
  platformFeeBps: bigint | null | undefined;
  wallet: Address;
  expiry: bigint;
  nowSec: number;
  onConsignmentChanged: () => void;
}) {
  const [listExpanded, setListExpanded] = useState(false);
  const item = deriveFixedPriceConsignment(
    marketplaceAuthToLifecycleInput(
      {
        tokenId,
        agent: wallet,
        expiry: String(expiry),
        ownerMinPrice1e8: String(ownerMinPrice1e8),
        active: true,
        hasActiveListing: false,
      },
      null,
      nowSec,
    ),
  );

  return (
    <ConsignmentPortfolioRow
      tokenId={tokenId}
      chainId={chainId}
      href={`/marketplace/${tokenId}?chain=${chainId}`}
      statusLabel={item.statusLabel}
      trackLabel="Fixed price"
      peerAddress={owner}
      peerLabel="Owner"
      make={make}
      model={model}
      year={year}
      attention={item.attention}
      extraMeta={
        <>
          <div className="pt-1">
            <PassportStatusBadge status={status} />
          </div>
          {chainStatusUnavailable ? (
            <p className="font-sans text-xs text-text-tertiary">
              Status unavailable
            </p>
          ) : null}
        </>
      }
    >
      {!listExpanded ? (
        <Button
          type="button"
          variant="secondary"
          className="mt-3 w-full"
          onClick={() => setListExpanded(true)}
        >
          List vehicle
        </Button>
      ) : (
        <>
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={() => setListExpanded(false)}
              className="font-sans text-xs text-text-secondary underline-offset-2 hover:text-text-primary hover:underline focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
            >
              Collapse
            </button>
          </div>
          <AgentListOnBehalfPanel
            chainId={chainId}
            tokenId={tokenId}
            ownerMinPrice1e8={ownerMinPrice1e8}
            platformFeeBps={platformFeeBps}
            wallet={wallet}
            onSuccess={() => {
              setListExpanded(false);
              onConsignmentChanged();
            }}
          />
        </>
      )}
    </ConsignmentPortfolioRow>
  );
}

function ActiveConsignmentCard({
  listing,
  row,
  chainId,
  platformFeeBps,
  wallet,
  onConsignmentChanged,
}: {
  listing: PonderAgentListingRaw;
  row: MarketplaceListingRow;
  chainId: number;
  platformFeeBps: bigint | null | undefined;
  wallet: Address;
  onConsignmentChanged: () => void;
}) {
  const [editExpanded, setEditExpanded] = useState(false);
  const tokenId = String(listing.tokenId ?? listing.id ?? "");
  const returnAt = parseReturnRequestedAt(listing.returnRequestedAt);

  return (
    <div className="space-y-0">
      <ListingCard row={row} />
      <div className="rounded-b-md border border-t-0 border-border-default bg-bg-surface px-4 py-3">
        {returnAt > 0n && (
          <div className="mb-3 space-y-2">
            <p className="font-sans text-xs text-text-secondary">Owner requested return</p>
            <ReturnCooldownDisplay returnRequestedAt={returnAt} />
          </div>
        )}
        {!editExpanded ? (
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              onClick={() => setEditExpanded(true)}
            >
              Edit listing
            </Button>
            <AgentDelistButton
              chainId={chainId}
              tokenId={tokenId}
              wallet={wallet}
              onSuccess={onConsignmentChanged}
            />
          </div>
        ) : (
          <>
            <div className="mb-2 flex justify-end">
              <button
                type="button"
                onClick={() => setEditExpanded(false)}
                className="font-sans text-xs text-text-secondary underline-offset-2 hover:text-text-primary hover:underline focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
              >
                Collapse
              </button>
            </div>
            <AgentUpdateListingPanel
              chainId={chainId}
              listing={listing}
              platformFeeBps={platformFeeBps}
              wallet={wallet}
              onSuccess={() => {
                setEditExpanded(false);
                onConsignmentChanged();
              }}
            />
            <AgentDelistButton
              chainId={chainId}
              tokenId={tokenId}
              wallet={wallet}
              onSuccess={onConsignmentChanged}
            />
          </>
        )}
      </div>
    </div>
  );
}

function parsePassportEnrichment(
  raw: Record<string, unknown>,
): PassportEnrichment | null {
  const id = typeof raw.id === "string" ? raw.id : "";
  if (!id) return null;
  return {
    owner: typeof raw.owner === "string" ? raw.owner : "",
    make: typeof raw.make === "string" ? raw.make : "",
    model: typeof raw.model === "string" ? raw.model : "",
    year: typeof raw.year === "number" ? raw.year : 0,
    status: (typeof raw.status === "string" ? raw.status : "UNVERIFIED") as PassportStatus,
  };
}

function useAgentListingsInfinite(
  wallet: Address,
  active: boolean,
) {
  return useInfiniteQuery({
    queryKey: ["agent-listings", wallet, active],
    queryFn: async ({ pageParam }) => {
      return getAgentListings(wallet, pageParam as number, LISTINGS_PAGE_SIZE, active);
    },
    initialPageParam: 1,
    getNextPageParam: (last) => {
      if (last.ponderError) return undefined;
      const totalPages = Math.ceil(last.total / last.limit);
      if (last.page < totalPages) return last.page + 1;
      return undefined;
    },
  });
}

function useAgentAuthorizationsInfinite(wallet: Address) {
  return useInfiniteQuery({
    queryKey: ["agent-awaiting", wallet],
    queryFn: async ({ pageParam }) => {
      return getAgentAuthorizations(
        wallet,
        pageParam as number,
        LISTINGS_PAGE_SIZE,
        false,
      );
    },
    initialPageParam: 1,
    getNextPageParam: (last) => {
      if (last.ponderError) return undefined;
      const totalPages = Math.ceil(last.total / last.limit);
      if (last.page < totalPages) return last.page + 1;
      return undefined;
    },
  });
}

function AwaitingAuthorizationsSection({
  wallet,
  chainId,
  wrongChain,
  platformFeeBps,
  onConsignmentChanged,
}: {
  wallet: Address;
  chainId: number;
  wrongChain: boolean;
  platformFeeBps: bigint | null | undefined;
  onConsignmentChanged: () => void;
}) {
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const inView = useInView(loadMoreRef, { margin: "200px" });
  const market = marketplaceAddress(chainId);
  const wc = wagmiChainId(chainId);
  const nowSec = useNow(30);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isPending,
    isError,
  } = useAgentAuthorizationsInfinite(wallet);

  const authorizations: PonderAgentAuthorization[] = useMemo(
    () => data?.pages.flatMap((page) => page.authorizations) ?? [],
    [data],
  );

  const awaitingTokenIds = useMemo(
    () => authorizations.map((a) => a.tokenId),
    [authorizations],
  );

  const ponderError = data?.pages[0]?.ponderError;

  const passportQuery = useQuery({
    queryKey: ["agent-awaiting-passports", wallet, awaitingTokenIds],
    queryFn: async () => {
      const batch = await fetchPassportBatch(awaitingTokenIds);
      const passportMap = new Map<string, PassportEnrichment>();
      for (const row of batch.passports) {
        const enriched = parsePassportEnrichment(row as Record<string, unknown>);
        if (enriched) passportMap.set(row.id, enriched);
      }
      return { passportMap, ponderError: batch.ponderError };
    },
    enabled: awaitingTokenIds.length > 0 && !ponderError,
  });

  const passportMap = passportQuery.data?.passportMap ?? new Map<string, PassportEnrichment>();

  const authContracts = useMemo(() => {
    if (!market || wrongChain || awaitingTokenIds.length === 0) return [];
    return awaitingTokenIds.map((tokenId) => ({
      address: market,
      abi: MarketplaceEscrowAbi,
      functionName: "agentAuthorizations" as const,
      args: [BigInt(tokenId)] as const,
      chainId: wc,
    }));
  }, [market, wrongChain, awaitingTokenIds, wc]);

  const {
    data: chainAuthReads,
    isLoading: isChainAuthLoading,
  } = useReadContracts({
    contracts: authContracts,
    query: { enabled: authContracts.length > 0 },
  });

  const chainAuthByTokenId = useMemo(() => {
    const map = new Map<string, { active: boolean; failed: boolean }>();
    if (!chainAuthReads) return map;
    awaitingTokenIds.forEach((tokenId, index) => {
      const read = chainAuthReads[index];
      if (!read) return;
      if (read.status === "failure") {
        map.set(tokenId, { active: true, failed: true });
        return;
      }
      const authorization = parseMarketplaceAgentAuthorization(read.result);
      map.set(tokenId, {
        active: authorization?.active === true,
        failed: false,
      });
    });
    return map;
  }, [chainAuthReads, awaitingTokenIds]);

  const visibleAwaiting = useMemo(() => {
    if (wrongChain || authContracts.length === 0) {
      return authorizations.map((auth) => ({
        auth,
        passport: passportMap.get(auth.tokenId),
        chainStatusUnavailable: false,
      }));
    }
    if (isChainAuthLoading) return null;
    return authorizations
      .filter((auth) => {
        const chain = chainAuthByTokenId.get(auth.tokenId);
        if (!chain) return true;
        if (chain.failed) return true;
        return chain.active;
      })
      .map((auth) => ({
        auth,
        passport: passportMap.get(auth.tokenId),
        chainStatusUnavailable: chainAuthByTokenId.get(auth.tokenId)?.failed === true,
      }));
  }, [
    authorizations,
    passportMap,
    wrongChain,
    authContracts.length,
    isChainAuthLoading,
    chainAuthByTokenId,
  ]);

  useEffect(() => {
    if (inView && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [inView, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const passportsLoading =
    awaitingTokenIds.length > 0 && passportQuery.isPending && !passportQuery.data;

  return (
    <section>
      <SectionHeading>Authorized — awaiting listing</SectionHeading>

      {ponderError && <PonderErrorBanner message="Indexer unavailable" />}

      {(isPending || passportsLoading) && !ponderError && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <li key={i}>
              <AwaitingCardSkeleton />
            </li>
          ))}
        </ul>
      )}

      {isError && !ponderError && (
        <div className="rounded-md border border-border-default bg-bg-surface p-4 text-sm text-text-secondary" role="alert">
          <p className="font-medium text-text-primary">Could not load authorizations right now.</p>
        </div>
      )}

      {!isPending &&
        !passportsLoading &&
        !ponderError &&
        visibleAwaiting !== null &&
        visibleAwaiting.length === 0 && (
          <EmptyState
            variant="content"
            level="B"
            className="py-8"
            title="No vehicles authorized yet"
          />
        )}

      {!ponderError && visibleAwaiting === null && !isPending && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {awaitingTokenIds.map((tokenId) => (
            <li key={tokenId}>
              <AwaitingCardSkeleton />
            </li>
          ))}
        </ul>
      )}

      {!ponderError && visibleAwaiting && visibleAwaiting.length > 0 && (
        <>
          <ul className="grid gap-3 sm:grid-cols-2">
            {visibleAwaiting.map(({ auth, passport, chainStatusUnavailable }) => (
              <li key={auth.tokenId}>
                <AuthorizedAwaitingCard
                  tokenId={auth.tokenId}
                  chainId={chainId}
                  status={passport?.status ?? "UNVERIFIED"}
                  make={passport?.make}
                  model={passport?.model}
                  year={passport?.year}
                  owner={passport?.owner ?? ""}
                  chainStatusUnavailable={chainStatusUnavailable}
                  ownerMinPrice1e8={BigInt(auth.ownerMinPrice1e8)}
                  platformFeeBps={platformFeeBps}
                  wallet={wallet}
                  expiry={BigInt(auth.expiry || 0)}
                  nowSec={nowSec}
                  onConsignmentChanged={onConsignmentChanged}
                />
              </li>
            ))}
          </ul>
          <div ref={loadMoreRef} className="flex justify-center py-6">
            {isFetchingNextPage && (
              <span className="text-sm text-text-secondary">Loading more…</span>
            )}
            {!hasNextPage && (
              <span className="text-xs text-text-tertiary">End of results</span>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function ListingsSection({
  title,
  wallet,
  active,
  emptyMessage,
  omitWhenEmpty,
  platformFeeBps,
  onConsignmentChanged,
}: {
  title: string;
  wallet: Address;
  active: boolean;
  emptyMessage: string;
  omitWhenEmpty?: boolean;
  platformFeeBps: bigint | null | undefined;
  onConsignmentChanged: () => void;
}) {
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const inView = useInView(loadMoreRef, { margin: "200px" });

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isPending,
    isError,
  } = useAgentListingsInfinite(wallet, active);

  const listingPairs = useMemo(() => {
    const listings =
      data?.pages.flatMap((page) => page.listings) ?? [];
    return listings.map((listing) => ({
      listing,
      row: mapAgentListingToRow(listing),
    }));
  }, [data]);

  const ponderError = data?.pages[0]?.ponderError;
  const total = data?.pages[0]?.total ?? 0;

  useEffect(() => {
    if (inView && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [inView, hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (!isPending && !ponderError && omitWhenEmpty && total === 0) {
    return null;
  }

  return (
    <section className="mt-10">
      <SectionHeading>{title}</SectionHeading>

      {ponderError && <PonderErrorBanner message="Indexer unavailable" />}

      {isPending && !ponderError && (
        <ul className={LISTING_CARD_GRID_NARROW}>
          {Array.from({ length: 2 }).map((_, i) => (
            <li key={i}>
              <ListingCardSkeleton />
            </li>
          ))}
        </ul>
      )}

      {isError && !ponderError && (
        <div className="rounded-md border border-border-default bg-bg-surface p-4 text-sm text-text-secondary" role="alert">
          <p className="font-medium text-text-primary">Could not load consignments right now.</p>
        </div>
      )}

      {!isPending && !ponderError && listingPairs.length === 0 && (
        <EmptyState
          variant="content"
          level="B"
          className="py-4"
          title={emptyMessage}
        />
      )}

      {!ponderError && listingPairs.length > 0 && (
        <>
          <ul className={LISTING_CARD_GRID_NARROW}>
            {listingPairs.map(({ listing, row }) => (
              <li key={row.tokenId}>
                {active ? (
                  <ActiveConsignmentCard
                    listing={listing}
                    row={row}
                    chainId={row.chainId}
                    platformFeeBps={platformFeeBps}
                    wallet={wallet}
                    onConsignmentChanged={onConsignmentChanged}
                  />
                ) : (
                  <ListingCard row={row} />
                )}
              </li>
            ))}
          </ul>
          <div ref={loadMoreRef} className="flex justify-center py-6">
            {isFetchingNextPage && (
              <span className="text-sm text-text-secondary">Loading more…</span>
            )}
            {!hasNextPage && (
              <span className="text-xs text-text-tertiary">End of results</span>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function useAgentAuctionAuthorizationsInfinite(wallet: Address) {
  return useInfiniteQuery({
    queryKey: ["agent-auction-awaiting", wallet],
    queryFn: async ({ pageParam }) => {
      return getAgentAuctionAuthorizations(
        wallet,
        pageParam as number,
        LISTINGS_PAGE_SIZE,
        true,
      );
    },
    initialPageParam: 1,
    getNextPageParam: (last) => {
      if (last.ponderError) return undefined;
      const totalPages = Math.ceil(last.total / last.limit);
      if (last.page < totalPages) return last.page + 1;
      return undefined;
    },
  });
}

function useAgentActiveAuctionsInfinite(wallet: Address, chainId: number) {
  return useInfiniteQuery({
    queryKey: ["agent-auction-active", wallet, chainId],
    queryFn: async ({ pageParam }) => {
      return getAgentActiveAuctions(
        wallet,
        pageParam as number,
        LISTINGS_PAGE_SIZE,
        chainId,
      );
    },
    initialPageParam: 1,
    getNextPageParam: (last) => {
      if (last.ponderError) return undefined;
      const totalPages = Math.ceil(last.total / last.limit);
      if (last.page < totalPages) return last.page + 1;
      return undefined;
    },
  });
}

function AwaitingAuctionCard({
  auth,
  chainId,
  nowSec,
  onConsignmentChanged,
}: {
  auth: PonderAuctionAuthorizationRaw;
  chainId: number;
  nowSec: number;
  onConsignmentChanged: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const item = deriveAuctionConsignment(
    auctionAuthToLifecycleInput(auth, null, nowSec),
  );
  const expired = item.stateId === "A1e";
  const assetLabel = auctionAssetLabelFromAddress(auth.asset);
  const ownerMin =
    auth.ownerMinAsset != null ? BigInt(auth.ownerMinAsset) : 0n;
  const status = (auth.passportStatus as PassportStatus) || "UNVERIFIED";
  const make = auth.make || undefined;
  const model = auth.model || undefined;
  const year = auth.year ?? undefined;

  return (
    <ConsignmentPortfolioRow
      tokenId={auth.tokenId}
      chainId={chainId}
      href={`/marketplace/${auth.tokenId}?chain=${chainId}`}
      statusLabel={item.statusLabel}
      trackLabel="Auction"
      peerAddress={auth.owner}
      peerLabel="Owner"
      make={make}
      model={model}
      year={year}
      attention={item.attention}
      extraMeta={
        <>
          <div className="pt-1">
            <PassportStatusBadge status={status} />
          </div>
          <p className="font-mono text-xs tabular-nums text-text-secondary">
            Min {formatAuctionAmount(ownerMin, assetLabel)} · {assetLabel}
          </p>
        </>
      }
    >
      {!expired &&
        (!expanded ? (
          <Button
            type="button"
            variant="secondary"
            className="mt-3 w-full"
            onClick={() => setExpanded(true)}
          >
            Start auction
          </Button>
        ) : (
          <>
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="font-sans text-xs text-text-secondary underline-offset-2 hover:text-text-primary hover:underline focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
              >
                Collapse
              </button>
            </div>
            <div className="mt-3">
              <AgentCreateAuctionPanel
                chainId={chainId}
                tokenId={auth.tokenId}
                onSuccess={() => {
                  setExpanded(false);
                  onConsignmentChanged();
                }}
              />
            </div>
          </>
        ))}
    </ConsignmentPortfolioRow>
  );
}

function AwaitingAuctionAuthorizationsSection({
  wallet,
  chainId,
  onConsignmentChanged,
}: {
  wallet: Address;
  chainId: number;
  onConsignmentChanged: () => void;
}) {
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const inView = useInView(loadMoreRef, { margin: "200px" });
  const nowSec = useNow(60_000);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isPending,
    isError,
  } = useAgentAuctionAuthorizationsInfinite(wallet);

  const authorizations = useMemo(
    () => data?.pages.flatMap((page) => page.authorizations) ?? [],
    [data],
  );
  const ponderError = data?.pages[0]?.ponderError;

  useEffect(() => {
    if (inView && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [inView, hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <section className="mt-10">
      <SectionHeading>Awaiting auction</SectionHeading>

      {ponderError && <PonderErrorBanner message="Indexer unavailable" />}

      {isPending && !ponderError && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <li key={i}>
              <AwaitingCardSkeleton />
            </li>
          ))}
        </ul>
      )}

      {isError && !ponderError && (
        <div
          className="rounded-md border border-border-default bg-bg-surface p-4 text-sm text-text-secondary"
          role="alert"
        >
          <p className="font-medium text-text-primary">
            Could not load auction authorizations right now.
          </p>
        </div>
      )}

      {!isPending && !ponderError && authorizations.length === 0 && (
        <EmptyState
          variant="content"
          level="B"
          className="py-8"
          title="No vehicles awaiting auction"
        />
      )}

      {!ponderError && authorizations.length > 0 && (
        <>
          <ul className="grid gap-3 sm:grid-cols-2">
            {authorizations.map((auth) => (
              <li key={auth.tokenId}>
                <AwaitingAuctionCard
                  auth={auth}
                  chainId={chainId}
                  nowSec={nowSec}
                  onConsignmentChanged={onConsignmentChanged}
                />
              </li>
            ))}
          </ul>
          <div ref={loadMoreRef} className="flex justify-center py-6">
            {isFetchingNextPage && (
              <span className="text-sm text-text-secondary">Loading more…</span>
            )}
            {!hasNextPage && (
              <span className="text-xs text-text-tertiary">End of results</span>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function ActiveAuctionCard({
  auction,
  onConsignmentChanged,
}: {
  auction: AuctionRow;
  onConsignmentChanged: () => void;
}) {
  const nowSec = useNow(30);
  const preStart = auction.startedAt === 0n;
  const item = deriveAuctionConsignment(
    auctionAuthToLifecycleInput(
      {
        tokenId: auction.tokenId,
        owner: auction.seller,
        agent: auction.agent ?? "",
        expiry: 0,
        asset: auction.asset,
        ownerMinAsset: String(auction.ownerMinAsset),
        active: true,
      },
      {
        active: auction.active,
        phase: auction.phase,
        startedAt: auction.startedAt,
        endsAtChain: auction.endsAt,
        returnRequestedAt: auction.returnRequestedAt ?? 0n,
        passportStatus: auction.passportStatus,
      },
      nowSec,
    ),
  );
  const statusLabel =
    item.stateId === "A2" || item.stateId === "A2r" || item.stateId === "A3"
      ? item.statusLabel
      : preStart
        ? "Awaiting first bid"
        : "Live auction";

  return (
    <div className="rounded-md border border-border-default bg-bg-surface px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/marketplace/${auction.tokenId}?chain=${auction.chainId}`}
          className={sansLinkUnderline}
        >
          <PassportIdLabel
            tokenId={auction.tokenId}
            chainId={auction.chainId}
            prefix="none"
            variant="mono"
            className="text-inherit"
          />
        </Link>
        {auction.passportStatus && (
          <PassportStatusBadge status={auction.passportStatus} />
        )}
      </div>
      {auction.make && auction.model && (
        <p className="mt-1 font-sans text-sm text-text-primary">
          {auction.year != null && auction.year > 0 ? `${auction.year} ` : ""}
          {auction.make} {auction.model}
        </p>
      )}
      <dl className="mt-3 space-y-1 font-mono text-xs tabular-nums text-text-secondary">
        <div className="flex justify-between gap-2">
          <dt>Reserve</dt>
          <dd className="text-text-primary">
            {formatAuctionAmount(auction.reserve, auction.assetLabel)}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>Commission</dt>
          <dd className="text-text-primary">
            {(auction.agentFeeBps / 100).toFixed(2)}%
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>Status</dt>
          <dd className="text-text-primary">{statusLabel}</dd>
        </div>
      </dl>
      <p className="mt-3">
        <Link
          href={`/marketplace/${auction.tokenId}?chain=${auction.chainId}`}
          className={sansLinkUnderline}
        >
          View lot →
        </Link>
      </p>
      {preStart && (
        <div className="mt-3">
          <AuctionCancelPanel
            chainId={auction.chainId}
            tokenId={auction.tokenId}
            auction={auction}
            onSuccess={onConsignmentChanged}
          />
        </div>
      )}
    </div>
  );
}

function ActiveAuctionsSection({
  wallet,
  chainId,
  onConsignmentChanged,
}: {
  wallet: Address;
  chainId: number;
  onConsignmentChanged: () => void;
}) {
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const inView = useInView(loadMoreRef, { margin: "200px" });

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isPending,
    isError,
  } = useAgentActiveAuctionsInfinite(wallet, chainId);

  const rows = useMemo(
    () => data?.pages.flatMap((page) => page.rows) ?? [],
    [data],
  );
  const ponderError = data?.pages[0]?.ponderError;

  useEffect(() => {
    if (inView && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [inView, hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <section className="mt-10">
      <SectionHeading>Active auctions</SectionHeading>

      {ponderError && <PonderErrorBanner message="Indexer unavailable" />}

      {isPending && !ponderError && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <li key={i}>
              <AwaitingCardSkeleton />
            </li>
          ))}
        </ul>
      )}

      {isError && !ponderError && (
        <div
          className="rounded-md border border-border-default bg-bg-surface p-4 text-sm text-text-secondary"
          role="alert"
        >
          <p className="font-medium text-text-primary">
            Could not load active auctions right now.
          </p>
        </div>
      )}

      {!isPending && !ponderError && rows.length === 0 && (
        <EmptyState
          variant="content"
          level="B"
          className="py-8"
          title="No active auctions"
        />
      )}

      {!ponderError && rows.length > 0 && (
        <>
          <ul className="grid gap-3 sm:grid-cols-2">
            {rows.map((auction) => (
              <li key={auction.tokenId}>
                <ActiveAuctionCard
                  auction={auction}
                  onConsignmentChanged={onConsignmentChanged}
                />
              </li>
            ))}
          </ul>
          <div ref={loadMoreRef} className="flex justify-center py-6">
            {isFetchingNextPage && (
              <span className="text-sm text-text-secondary">Loading more…</span>
            )}
            {!hasNextPage && (
              <span className="text-xs text-text-tertiary">End of results</span>
            )}
          </div>
        </>
      )}
    </section>
  );
}

export function ConsignedVehiclesTab({ wallet, chainId }: Props) {
  const { chainId: connectedChainId } = useAccount();
  const queryClient = useQueryClient();
  const router = useRouter();
  const wc = wagmiChainId(chainId);
  const market = marketplaceAddress(chainId);
  const wrongChain =
    connectedChainId != null && connectedChainId !== wc;

  const { data: platformFeeBpsRaw } = useReadContract({
    address: market ?? undefined,
    abi: MarketplaceEscrowAbi,
    functionName: "platformFeeBps",
    chainId: wc,
    query: { enabled: Boolean(market) },
  });

  const platformFeeBps =
    platformFeeBpsRaw != null ? BigInt(platformFeeBpsRaw) : undefined;

  const onConsignmentChanged = useCallback(() => {
    void invalidateAgentConsignmentQueries(wallet, queryClient, router);
  }, [wallet, queryClient, router]);

  return (
    <div className="space-y-2">
      {wrongChain && (
        <p className="mb-4 rounded-md border border-border-default bg-bg-surface px-4 py-3 text-sm text-text-secondary">
          Switch to Base Sepolia to verify authorization status.
        </p>
      )}

      <AwaitingAuthorizationsSection
        wallet={wallet}
        chainId={chainId}
        wrongChain={wrongChain}
        platformFeeBps={platformFeeBps}
        onConsignmentChanged={onConsignmentChanged}
      />

      <ListingsSection
        title="Active consignments"
        wallet={wallet}
        active
        emptyMessage="No active consignments"
        platformFeeBps={platformFeeBps}
        onConsignmentChanged={onConsignmentChanged}
      />

      <ListingsSection
        title="Past consignments"
        wallet={wallet}
        active={false}
        emptyMessage="No past consignments"
        omitWhenEmpty
        platformFeeBps={platformFeeBps}
        onConsignmentChanged={onConsignmentChanged}
      />

      <AwaitingAuctionAuthorizationsSection
        wallet={wallet}
        chainId={chainId}
        onConsignmentChanged={onConsignmentChanged}
      />

      <ActiveAuctionsSection
        wallet={wallet}
        chainId={chainId}
        onConsignmentChanged={onConsignmentChanged}
      />
    </div>
  );
}
