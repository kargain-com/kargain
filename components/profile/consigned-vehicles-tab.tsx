"use client";

import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { useReadContract } from "wagmi";

import { getConsignments } from "@/app/actions/commerce-consignments";
import { getAgentMandates } from "@/app/actions/commerce-mandates";
import { AgentCreateAuctionPanel } from "@/components/auction/agent-create-auction-panel";
import { AgentLowerCommissionPanel } from "@/components/commerce/agent-lower-commission-panel";
import { ConsignmentPortfolioRow } from "@/components/consignment/consignment-portfolio-row";
import { AgentDelistButton } from "@/components/marketplace/agent-delist-button";
import { AgentListOnBehalfPanel } from "@/components/marketplace/agent-list-on-behalf-panel";
import { AgentUpdateListingPanel } from "@/components/marketplace/agent-update-listing-panel";
import { EmptyState } from "@/components/ui/empty-state";
import {
  COMPENSATION_FORM,
} from "@/lib/commerce/denomination";
import type { MandateSnapshot } from "@/lib/commerce/mandate";
import { commerceModeAddress } from "@/lib/commerce/mode";
import type { MandateRecord } from "@/lib/commerce/ponder-consignment";
import { FixedPriceConsignmentAbi } from "@/lib/contracts/abis.generated";
import { categoryLabel } from "@/lib/design/instrument-classes";
import { resolveKarProTargetChainId } from "@/lib/kar-pro/kar-pro-target-chain";
import { indexerQueryKey } from "@/lib/web3/indexer-query-keys";
import { shortChainName, wagmiChainId } from "@/lib/web3/supported-chains";
import { cn } from "@/lib/utils";

type Props = {
  wallet: Address;
  chainId: number;
};

function mandateRecordToSnapshot(row: MandateRecord): MandateSnapshot {
  return {
    mode: row.mode,
    tokenId: row.tokenId,
    agent: row.agent,
    expiry: row.expiry,
    asset: row.asset,
    denominationKind: row.denominationKind,
    currencyCode: (row.currencyCode.startsWith("0x")
      ? row.currencyCode
      : `0x${row.currencyCode}`) as `0x${string}`,
    floor: row.floor,
    compensationForm: row.compensationForm,
    commissionBps: row.commissionBps,
    active: row.active,
  };
}

/**
 * Agent consignment inbox: standing mandates + live consignments.
 * Commerce Ponder routes only (FixedPrice / Ascending modes).
 */
export function ConsignedVehiclesTab({ wallet, chainId }: Props) {
  const targetChain = resolveKarProTargetChainId(chainId) ?? chainId;
  const fixedPrice = commerceModeAddress("fixedPrice", targetChain);
  const ascending = commerceModeAddress("ascending", targetChain);
  const modesReady = Boolean(fixedPrice || ascending);

  const { data: platformFeeBps } = useReadContract({
    address: fixedPrice,
    abi: FixedPriceConsignmentAbi,
    functionName: "platformFeeBps",
    chainId: wagmiChainId(targetChain),
    query: { enabled: Boolean(fixedPrice) },
  });

  const awaitingQuery = useQuery({
    queryKey: indexerQueryKey("agent-mandates", targetChain, wallet, "awaiting"),
    queryFn: () =>
      getAgentMandates(wallet, {
        active: true,
        hasLiveConsignment: false,
        page: 1,
        limit: 50,
      }),
    enabled: modesReady,
  });

  const liveQuery = useQuery({
    queryKey: indexerQueryKey("agent-consignments", targetChain, wallet, "live"),
    queryFn: () =>
      getConsignments({
        agent: wallet,
        live: true,
        chainId: targetChain,
        page: 1,
        limit: 50,
      }),
    enabled: modesReady,
  });

  const awaiting = awaitingQuery.data?.rows ?? [];
  const live = liveQuery.data?.rows ?? [];
  const loading = awaitingQuery.isPending || liveQuery.isPending;
  const unavailable =
    awaitingQuery.data?.ponderError === "PONDER_UNAVAILABLE" ||
    liveQuery.data?.ponderError === "PONDER_UNAVAILABLE";

  const refresh = () => {
    void awaitingQuery.refetch();
    void liveQuery.refetch();
  };

  if (!modesReady) {
    return (
      <EmptyState
        variant="infrastructure"
        level="B"
        title="Commerce not available"
        description="Fixed-price and ascending modes are not deployed on this network yet."
      />
    );
  }

  if (unavailable) {
    return (
      <EmptyState
        variant="infrastructure"
        level="B"
        title="Indexer unavailable"
        description="Could not load mandates or consignments."
        role="alert"
      />
    );
  }

  if (loading) {
    return (
      <p className="text-sm text-text-secondary">Loading consignments…</p>
    );
  }

  if (awaiting.length === 0 && live.length === 0) {
    return (
      <EmptyState
        variant="content"
        level="B"
        title="No consignments yet"
        description="When an owner grants you a mandate, it appears here so you can open a sale."
      />
    );
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className={cn(categoryLabel)}>Awaiting open</h2>
        {awaiting.length === 0 ? (
          <p className="text-sm text-text-secondary">No standing mandates.</p>
        ) : (
          <ul className="space-y-3">
            {awaiting.map((row) => {
              const mandate = mandateRecordToSnapshot(row);
              const href = `/marketplace/${row.tokenId}?chain=${row.chainId}`;
              return (
                <ConsignmentPortfolioRow
                  key={row.id}
                  tokenId={row.tokenId}
                  chainId={row.chainId}
                  href={href}
                  statusLabel="Mandate active"
                  trackLabel={
                    row.mode === "ascending" ? "Ascending" : "Fixed price"
                  }
                  peerAddress={row.owner}
                  peerLabel="Owner"
                  extraMeta={
                    <span className="font-mono text-xs text-text-tertiary">
                      {shortChainName(row.chainId)}
                    </span>
                  }
                >
                  {row.mode === "fixedPrice" ? (
                    <AgentListOnBehalfPanel
                      chainId={row.chainId}
                      tokenId={row.tokenId}
                      mandate={mandate}
                      platformFeeBps={
                        typeof platformFeeBps === "bigint" ? platformFeeBps : null
                      }
                      wallet={wallet}
                      onSuccess={refresh}
                    />
                  ) : (
                    <AgentCreateAuctionPanel
                      chainId={row.chainId}
                      tokenId={row.tokenId}
                      onSuccess={refresh}
                    />
                  )}
                </ConsignmentPortfolioRow>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className={cn(categoryLabel)}>Live consignments</h2>
        {live.length === 0 ? (
          <p className="text-sm text-text-secondary">No live consignments.</p>
        ) : (
          <ul className="space-y-3">
            {live.map((row) => {
              const href = `/marketplace/${row.tokenId}?chain=${row.chainId}`;
              return (
                <ConsignmentPortfolioRow
                  key={row.id}
                  tokenId={row.tokenId}
                  chainId={row.chainId}
                  href={href}
                  statusLabel={row.phase}
                  trackLabel={
                    row.mode === "ascending" ? "Ascending" : "Fixed price"
                  }
                  peerAddress={row.seller}
                  peerLabel="Owner"
                  extraMeta={
                    <span className="font-mono text-xs text-text-tertiary">
                      {shortChainName(row.chainId)}
                    </span>
                  }
                >
                  {row.mode === "fixedPrice" ? (
                    <div className="flex flex-wrap gap-3">
                      <AgentUpdateListingPanel
                        chainId={row.chainId}
                        tokenId={row.tokenId}
                        price1e8={row.price}
                        floor1e8={row.floor}
                        compensationForm={
                          row.compensationForm === COMPENSATION_FORM.Commission
                            ? COMPENSATION_FORM.Commission
                            : COMPENSATION_FORM.Margin
                        }
                        commissionBps={row.commissionBps}
                        platformFeeBps={
                          typeof platformFeeBps === "bigint"
                            ? platformFeeBps
                            : BigInt(row.platformFeeBps)
                        }
                        wallet={wallet}
                        onSuccess={refresh}
                      />
                      <AgentDelistButton
                        chainId={row.chainId}
                        tokenId={row.tokenId}
                        wallet={wallet}
                        onSuccess={refresh}
                      />
                    </div>
                  ) : (
                    <AgentLowerCommissionPanel
                      mode="ascending"
                      chainId={row.chainId}
                      tokenId={row.tokenId}
                      live={true}
                      isConsignmentAgent={true}
                      compensationForm={row.compensationForm}
                      snapshotCommissionBps={row.commissionBps}
                      onChanged={refresh}
                    />
                  )}
                </ConsignmentPortfolioRow>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
