"use client";

import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";

import type { PonderAuctionAuthorizationRaw } from "@/app/actions/auction-agent";
import { getProfileData } from "@/app/actions/marketplace-listings";
import { fetchPassportBatch } from "@/app/actions/notifications";
import {
  getOwnerActiveAuctions,
  getOwnerAuctionAuthorizations,
  getOwnerAuthorizations,
} from "@/app/actions/owner-consignment";
import { ConsignmentPortfolioRow } from "@/components/consignment/consignment-portfolio-row";
import { EmptyState } from "@/components/ui/empty-state";
import type { AuctionRow } from "@/lib/auction/map-ponder-auction";
import {
  deriveAuctionConsignment,
  deriveFixedPriceConsignment,
  type ConsignmentPortfolioItem,
  type ConsignmentStateId,
  type ConsignmentTrack,
} from "@/lib/consignment/lifecycle";
import {
  auctionAuthToLifecycleInput,
  marketplaceAuthToLifecycleInput,
} from "@/lib/consignment/map-authorization";
import { categoryLabel } from "@/lib/design/instrument-classes";
import { hasListingAgent } from "@/lib/marketplace/listing-agent";
import type { PonderAgentAuthorization } from "@/lib/types/ponder";
import { useNow } from "@/hooks/use-now";
import { cn } from "@/lib/utils";

type Props = {
  wallet: Address;
  chainId: number;
};

const PAGE_LIMIT = 50;

const AWAITING_IDS = new Set<ConsignmentStateId>(["M1", "A1"]);
const LIVE_IDS = new Set<ConsignmentStateId>([
  "M2",
  "M2r",
  "A2",
  "A2r",
  "A3",
]);

type PortfolioRowView = {
  key: string;
  tokenId: string;
  track: ConsignmentTrack;
  item: ConsignmentPortfolioItem;
  agentAddress: string | null;
  make?: string | null;
  model?: string | null;
  year?: number | null;
};

type ProfileListingRaw = {
  tokenId?: string;
  id?: string;
  active?: boolean;
  agent?: string | null;
  returnRequestedAt?: string | number | null;
  make?: string;
  model?: string;
  year?: number;
};

type PassportEnrichment = {
  make: string;
  model: string;
  year: number;
};

function SectionHeading({ children }: { children: string }) {
  return <h3 className={cn(categoryLabel, "mb-3")}>{children}</h3>;
}

function RowSkeleton() {
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
      <p className="mt-1">Start the Ponder indexer to load delegated vehicles.</p>
      <code className="mt-2 inline-block rounded-sm bg-bg-card px-2 py-1 font-mono text-xs">
        pnpm ponder:dev
      </code>
    </div>
  );
}

function trackLabel(track: ConsignmentTrack): "Fixed price" | "Auction" {
  return track === "fixed_price" ? "Fixed price" : "Auction";
}

function listingTokenId(listing: ProfileListingRaw): string {
  return String(listing.tokenId ?? listing.id ?? "");
}

function buildMarketplaceRows(
  auths: PonderAgentAuthorization[],
  listingsByToken: Map<string, ProfileListingRaw>,
  passportsByToken: Map<string, PassportEnrichment>,
  nowSec: number,
): PortfolioRowView[] {
  const rows: PortfolioRowView[] = [];
  for (const auth of auths) {
    const listing = auth.hasActiveListing
      ? listingsByToken.get(auth.tokenId) ?? null
      : null;
    const listingFacts =
      listing != null
        ? {
            active: listing.active === true,
            agent: listing.agent ?? auth.agent,
            returnRequestedAt: listing.returnRequestedAt ?? 0n,
          }
        : auth.hasActiveListing
          ? {
              active: true,
              agent: auth.agent,
              returnRequestedAt: 0n,
            }
          : null;
    const item = deriveFixedPriceConsignment(
      marketplaceAuthToLifecycleInput(auth, listingFacts, nowSec),
    );
    if (item.stateId === "none") continue;
    const passport = passportsByToken.get(auth.tokenId);
    const listingTitle = listing;
    rows.push({
      key: `fixed_price:${auth.tokenId}`,
      tokenId: auth.tokenId,
      track: "fixed_price",
      item,
      agentAddress: auth.agent,
      make: listingTitle?.make ?? passport?.make,
      model: listingTitle?.model ?? passport?.model,
      year: listingTitle?.year ?? passport?.year,
    });
  }
  return rows;
}

function buildAuctionRows(
  auths: PonderAuctionAuthorizationRaw[],
  auctionsByToken: Map<string, AuctionRow>,
  passportsByToken: Map<string, PassportEnrichment>,
  nowSec: number,
): PortfolioRowView[] {
  const rows: PortfolioRowView[] = [];
  for (const auth of auths) {
    const auction = auctionsByToken.get(auth.tokenId);
    const auctionFacts =
      auction != null
        ? {
            active: auction.active,
            phase: auction.phase,
            startedAt: auction.startedAt,
            endsAtChain: auction.endsAt,
            returnRequestedAt: auction.returnRequestedAt ?? 0n,
            passportStatus: auction.passportStatus,
          }
        : null;
    const item = deriveAuctionConsignment(
      auctionAuthToLifecycleInput(auth, auctionFacts, nowSec),
    );
    if (item.stateId === "none") continue;
    const passport = passportsByToken.get(auth.tokenId);
    rows.push({
      key: `auction:${auth.tokenId}`,
      tokenId: auth.tokenId,
      track: "auction",
      item,
      agentAddress: auth.agent,
      make: auction?.make ?? passport?.make ?? auth.make,
      model: auction?.model ?? passport?.model ?? auth.model,
      year: auction?.year ?? passport?.year ?? auth.year,
    });
  }
  return rows;
}

function buildPastRows(
  listings: ProfileListingRaw[],
  activeTokenIds: Set<string>,
  chainId: number,
): PortfolioRowView[] {
  const rows: PortfolioRowView[] = [];
  for (const listing of listings) {
    if (listing.active !== false) continue;
    if (!hasListingAgent(listing.agent)) continue;
    const tokenId = listingTokenId(listing);
    if (!tokenId || activeTokenIds.has(tokenId)) continue;
    rows.push({
      key: `past:${tokenId}`,
      tokenId,
      track: "fixed_price",
      item: {
        track: "fixed_price",
        stateId: "M2",
        attention: false,
        primaryHref: `/marketplace/${tokenId}?chain=${chainId}`,
        statusLabel: "Past consignment",
      },
      agentAddress: listing.agent ?? null,
      make: listing.make,
      model: listing.model,
      year: listing.year,
    });
  }
  return rows;
}

function bucketRows(rows: PortfolioRowView[]): {
  attention: PortfolioRowView[];
  awaiting: PortfolioRowView[];
  live: PortfolioRowView[];
} {
  const attention: PortfolioRowView[] = [];
  const awaiting: PortfolioRowView[] = [];
  const live: PortfolioRowView[] = [];
  for (const row of rows) {
    if (row.item.attention) {
      attention.push(row);
      continue;
    }
    if (AWAITING_IDS.has(row.item.stateId)) {
      awaiting.push(row);
      continue;
    }
    if (LIVE_IDS.has(row.item.stateId)) {
      live.push(row);
    }
  }
  return { attention, awaiting, live };
}

export function DelegatedVehiclesTab({ wallet, chainId }: Props) {
  const nowSec = useNow(30);

  const marketplaceQuery = useQuery({
    queryKey: ["owner-delegated-auths", wallet],
    queryFn: () => getOwnerAuthorizations(wallet, 1, PAGE_LIMIT),
  });

  const auctionAuthQuery = useQuery({
    queryKey: ["owner-delegated-auction-auths", wallet],
    queryFn: () => getOwnerAuctionAuthorizations(wallet, 1, PAGE_LIMIT),
  });

  const profileQuery = useQuery({
    queryKey: ["owner-delegated-profile", wallet],
    queryFn: () => getProfileData(wallet),
  });

  const auctionsQuery = useQuery({
    queryKey: ["owner-delegated-auctions", wallet, chainId],
    queryFn: () => getOwnerActiveAuctions(wallet, 1, PAGE_LIMIT, chainId),
  });

  const marketplaceAuths = marketplaceQuery.data?.authorizations ?? [];
  const auctionAuths = auctionAuthQuery.data?.authorizations ?? [];

  const tokenIdsForBatch = [
    ...new Set([
      ...marketplaceAuths.map((row) => row.tokenId),
      ...auctionAuths.map((row) => row.tokenId),
    ]),
  ].filter(Boolean);

  const passportBatchQuery = useQuery({
    queryKey: ["owner-delegated-passports", wallet, tokenIdsForBatch.join(",")],
    queryFn: () => fetchPassportBatch(tokenIdsForBatch),
    enabled: tokenIdsForBatch.length > 0,
  });

  const isLoading =
    marketplaceQuery.isPending ||
    auctionAuthQuery.isPending ||
    profileQuery.isPending ||
    auctionsQuery.isPending ||
    (tokenIdsForBatch.length > 0 && passportBatchQuery.isPending);

  const ponderError =
    marketplaceQuery.data?.ponderError ||
    auctionAuthQuery.data?.ponderError ||
    auctionsQuery.data?.ponderError ||
    passportBatchQuery.data?.ponderError;

  const listings = (profileQuery.data?.listings ?? []) as ProfileListingRaw[];
  const listingsByToken = new Map(
    listings
      .map((listing) => [listingTokenId(listing), listing] as const)
      .filter(([id]) => id.length > 0),
  );

  const auctionsByToken = new Map(
    (auctionsQuery.data?.rows ?? []).map((row) => [row.tokenId, row] as const),
  );

  const passportsByToken = new Map<string, PassportEnrichment>();
  for (const passport of passportBatchQuery.data?.passports ?? []) {
    const raw = passport as Record<string, unknown>;
    const id = typeof raw.id === "string" ? raw.id : "";
    if (!id) continue;
    passportsByToken.set(id, {
      make: typeof raw.make === "string" ? raw.make : "",
      model: typeof raw.model === "string" ? raw.model : "",
      year: typeof raw.year === "number" ? raw.year : Number(raw.year ?? 0),
    });
  }

  const activeRows = [
    ...buildMarketplaceRows(
      marketplaceAuths,
      listingsByToken,
      passportsByToken,
      nowSec,
    ),
    ...buildAuctionRows(
      auctionAuths,
      auctionsByToken,
      passportsByToken,
      nowSec,
    ),
  ];

  const activeTokenIds = new Set(activeRows.map((row) => row.tokenId));
  const pastRows = buildPastRows(listings, activeTokenIds, chainId);
  const { attention, awaiting, live } = bucketRows(activeRows);

  const hasAny =
    attention.length > 0 ||
    awaiting.length > 0 ||
    live.length > 0 ||
    pastRows.length > 0;

  function renderSection(title: string, sectionRows: PortfolioRowView[]) {
    if (sectionRows.length === 0) return null;
    return (
      <div>
        <SectionHeading>{title}</SectionHeading>
        <div className="grid gap-3">
          {sectionRows.map((row) => (
            <ConsignmentPortfolioRow
              key={row.key}
              tokenId={row.tokenId}
              chainId={chainId}
              href={
                row.item.primaryHref.includes("?")
                  ? row.item.primaryHref
                  : `${row.item.primaryHref}?chain=${chainId}`
              }
              statusLabel={row.item.statusLabel}
              trackLabel={trackLabel(row.track)}
              peerAddress={row.agentAddress}
              peerLabel="Agent"
              make={row.make}
              model={row.model}
              year={row.year}
              attention={row.item.attention}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {ponderError ? (
        <PonderErrorBanner message="Delegated vehicle data is unavailable" />
      ) : null}

      {isLoading ? (
        <div className="grid gap-3">
          <RowSkeleton />
          <RowSkeleton />
        </div>
      ) : !hasAny ? (
        <EmptyState
          variant="content"
          level="B"
          title="No delegated vehicles"
          description="When you authorize a KarPro to sell a passport, it appears here."
          className="py-8"
        />
      ) : (
        <>
          {renderSection("Needs attention", attention)}
          {renderSection("Awaiting agent", awaiting)}
          {renderSection("Live", live)}
          {pastRows.length > 0
            ? renderSection("Past", pastRows)
            : null}
        </>
      )}
    </div>
  );
}
