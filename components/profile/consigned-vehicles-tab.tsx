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
import { fetchPassportBatch } from "@/app/actions/notifications";
import { AgentDelistButton } from "@/components/marketplace/agent-delist-button";
import { AgentListOnBehalfPanel } from "@/components/marketplace/agent-list-on-behalf-panel";
import { AgentUpdateListingPanel } from "@/components/marketplace/agent-update-listing-panel";
import { ListingCard } from "@/components/marketplace/listing-card";
import { ReturnCooldownDisplay } from "@/components/marketplace/return-cooldown-display";
import { PassportIdLabel } from "@/components/passport/passport-id-label";
import { Button } from "@/components/ui/button";
import { EnsWalletLink } from "@/components/ui/ens-wallet-link";
import { PassportStatusBadge } from "@/components/ui/passport-status-badge";
import { MarketplaceEscrowAbi } from "@/lib/contracts/abis.generated";
import {
  mapAgentListingToRow,
  type MarketplaceListingRow,
} from "@/lib/marketplace/map-ponder-listing";
import { parseReturnRequestedAt } from "@/lib/marketplace/listing-agent";
import type {
  PassportStatus,
  PonderAgentAuthorization,
  PonderAgentListingRaw,
} from "@/lib/types/ponder";
import { marketplaceAddress } from "@/lib/web3/deployment-addresses";
import { wagmiChainId } from "@/lib/web3/supported-chains";

type PassportEnrichment = {
  owner: string;
  make: string;
  model: string;
  year: number;
  status: PassportStatus;
};

type AgentAuthTuple = readonly [Address, bigint, bigint, boolean];

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
  ]);
  router.refresh();
}

function ListingCardSkeleton() {
  return (
    <div className="h-full overflow-hidden rounded-md border border-border-default bg-bg-card">
      <div className="aspect-[16/10] w-full animate-pulse bg-bg-surface" />
      <div className="space-y-2.5 p-6">
        <div className="h-4 w-3/4 animate-pulse rounded bg-bg-surface" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-bg-surface" />
        <div className="h-6 w-1/3 animate-pulse rounded bg-bg-surface" />
      </div>
    </div>
  );
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
  return (
    <h3 className="mb-4 font-sans text-sm font-medium text-text-primary">{children}</h3>
  );
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
  onConsignmentChanged: () => void;
}) {
  const [listExpanded, setListExpanded] = useState(false);

  return (
    <div className="rounded-md border border-border-default bg-bg-surface px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/marketplace/${tokenId}?chain=${chainId}`}
          className="text-text-primary underline-offset-2 hover:text-accent-warm hover:underline focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
        >
          <PassportIdLabel
            tokenId={tokenId}
            chainId={chainId}
            prefix="none"
            variant="mono"
            className="text-inherit"
          />
        </Link>
        <PassportStatusBadge status={status} />
      </div>
      {make && model && (
        <p className="mt-1 font-sans text-sm text-text-primary">
          {year != null && year > 0 ? `${year} ` : ""}
          {make} {model}
        </p>
      )}
      <p className="mt-2 font-sans text-xs text-text-secondary">
        Owner{" "}
        <EnsWalletLink
          address={owner}
          href={`/profile/${owner}`}
          className="text-accent-warm hover:underline"
        />
      </p>
      {chainStatusUnavailable && (
        <p className="mt-1 font-sans text-xs text-text-tertiary">Status unavailable</p>
      )}

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
    </div>
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
      const result = read.result as AgentAuthTuple | undefined;
      map.set(tokenId, { active: result?.[3] === true, failed: false });
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
          <p className="py-8 text-center text-sm text-text-secondary">
            No vehicles authorized yet
          </p>
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
        <ul className="grid gap-3 sm:grid-cols-2">
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
        <p className="py-4 text-center text-sm text-text-secondary">{emptyMessage}</p>
      )}

      {!ponderError && listingPairs.length > 0 && (
        <>
          <ul className="grid gap-3 sm:grid-cols-2">
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
    </div>
  );
}
