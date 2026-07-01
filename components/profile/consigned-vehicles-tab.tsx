"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useInView } from "framer-motion";
import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";
import type { Address } from "viem";
import { useAccount, useReadContracts } from "wagmi";

import {
  getAgentAuthorizations,
  getAgentListings,
} from "@/app/actions/agent-consignment";
import { fetchPassportBatch } from "@/app/actions/notifications";
import { ListingCard } from "@/components/marketplace/listing-card";
import { PassportIdLabel } from "@/components/passport/passport-id-label";
import { EnsWalletLink } from "@/components/ui/ens-wallet-link";
import { PassportStatusBadge } from "@/components/ui/passport-status-badge";
import { MarketplaceEscrowAbi } from "@/lib/contracts/abis.generated";
import {
  mapAgentListingToRow,
  type MarketplaceListingRow,
} from "@/lib/marketplace/map-ponder-listing";
import type { PassportStatus, PonderAgentAuthorization } from "@/lib/types/ponder";
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

function ListingCardSkeleton() {
  return (
    <div className="h-full overflow-hidden rounded-md border border-border-default bg-bg-card">
      <div className="aspect-[16/10] w-full animate-pulse bg-bg-surface" />
      <div className="space-y-2.5 p-4">
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
      className="rounded-sm border border-border-default bg-bg-surface p-4 text-sm text-text-secondary"
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
}: {
  tokenId: string;
  chainId: number;
  status: PassportStatus;
  make?: string;
  model?: string;
  year?: number;
  owner: string;
  chainStatusUnavailable?: boolean;
}) {
  return (
    <Link
      href={`/marketplace/${tokenId}?chain=${chainId}`}
      className="block rounded-md border border-border-default bg-bg-surface px-4 py-3 text-sm transition-colors duration-150 hover:border-border-hover focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
    >
      <div className="flex flex-wrap items-center gap-2">
        <PassportIdLabel
          tokenId={tokenId}
          chainId={chainId}
          prefix="none"
          variant="mono"
          className="text-text-primary"
        />
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
    </Link>
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
}: {
  wallet: Address;
  chainId: number;
  wrongChain: boolean;
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
        <div className="rounded-sm border border-border-default bg-bg-surface p-4 text-sm text-text-secondary" role="alert">
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
}: {
  title: string;
  wallet: Address;
  active: boolean;
  emptyMessage: string;
  omitWhenEmpty?: boolean;
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

  const rows: MarketplaceListingRow[] = useMemo(
    () =>
      data?.pages.flatMap((page) =>
        page.listings.map((listing) => mapAgentListingToRow(listing)),
      ) ?? [],
    [data],
  );

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
        <div className="rounded-sm border border-border-default bg-bg-surface p-4 text-sm text-text-secondary" role="alert">
          <p className="font-medium text-text-primary">Could not load consignments right now.</p>
        </div>
      )}

      {!isPending && !ponderError && rows.length === 0 && (
        <p className="py-4 text-center text-sm text-text-secondary">{emptyMessage}</p>
      )}

      {!ponderError && rows.length > 0 && (
        <>
          <ul className="grid gap-3 sm:grid-cols-2">
            {rows.map((row) => (
              <li key={row.tokenId}>
                <ListingCard row={row} />
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
  const wc = wagmiChainId(chainId);
  const wrongChain =
    connectedChainId != null && connectedChainId !== wc;

  return (
    <div className="space-y-2">
      {wrongChain && (
        <p className="mb-4 rounded-sm border border-border-default bg-bg-surface px-4 py-3 text-sm text-text-secondary">
          Switch to Base Sepolia to verify authorization status.
        </p>
      )}

      <AwaitingAuthorizationsSection
        wallet={wallet}
        chainId={chainId}
        wrongChain={wrongChain}
      />

      <ListingsSection
        title="Active consignments"
        wallet={wallet}
        active
        emptyMessage="No active consignments"
      />

      <ListingsSection
        title="Past consignments"
        wallet={wallet}
        active={false}
        emptyMessage="No past consignments"
        omitWhenEmpty
      />
    </div>
  );
}
