"use client";

import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";

import { getConsignments } from "@/app/actions/commerce-consignments";
import { getOwnerMandates } from "@/app/actions/commerce-mandates";
import { ConsignmentPortfolioRow } from "@/components/consignment/consignment-portfolio-row";
import { EmptyState } from "@/components/ui/empty-state";
import type { ConsignmentRecord } from "@/lib/commerce/ponder-consignment";
import { commerceModeAddress } from "@/lib/commerce/mode";
import { categoryLabel } from "@/lib/design/instrument-classes";
import { resolveKarProTargetChainId } from "@/lib/kar-pro/kar-pro-target-chain";
import { shortChainName } from "@/lib/web3/supported-chains";
import { cn } from "@/lib/utils";

type Props = {
  wallet: Address;
  chainId: number;
};

function trackLabel(mode: ConsignmentRecord["mode"]): "Fixed price" | "Ascending" {
  return mode === "ascending" ? "Ascending" : "Fixed price";
}

function phaseStatusLabel(row: ConsignmentRecord): string {
  if (row.recallRequestedAt > 0n) return "Return requested";
  if (row.phase === "offered" || row.phase === "binding") return "Live";
  if (row.phase === "held") return "Settlement hold";
  if (row.phase === "returned") return "Returned";
  return "Closed";
}

/**
 * Owner-out portfolio: standing mandates granted to agents + live consignments.
 * Commerce Ponder routes only (FixedPrice / Ascending modes).
 */
export function DelegatedVehiclesTab({ wallet, chainId }: Props) {
  const targetChain = resolveKarProTargetChainId(chainId) ?? chainId;
  const fixedPrice = commerceModeAddress("fixedPrice", targetChain);
  const ascending = commerceModeAddress("ascending", targetChain);
  const modesReady = Boolean(fixedPrice || ascending);

  const awaitingQuery = useQuery({
    queryKey: ["owner-mandates", wallet, targetChain, "awaiting"],
    queryFn: () =>
      getOwnerMandates(wallet, {
        active: true,
        hasLiveConsignment: false,
        page: 1,
        limit: 50,
      }),
    enabled: modesReady,
  });

  const liveQuery = useQuery({
    queryKey: ["owner-consignments", wallet, targetChain, "live"],
    queryFn: () =>
      getConsignments({
        seller: wallet,
        live: true,
        chainId: targetChain,
        page: 1,
        limit: 50,
      }),
    enabled: modesReady,
  });

  const pastQuery = useQuery({
    queryKey: ["owner-consignments", wallet, targetChain, "past"],
    queryFn: () =>
      getConsignments({
        seller: wallet,
        phase: "closed",
        chainId: targetChain,
        page: 1,
        limit: 50,
      }),
    enabled: modesReady,
  });

  const awaiting = awaitingQuery.data?.rows ?? [];
  const live = liveQuery.data?.rows ?? [];
  const past = pastQuery.data?.rows ?? [];
  const attention = live.filter((row) => row.recallRequestedAt > 0n);
  const liveNormal = live.filter((row) => row.recallRequestedAt === 0n);

  const loading =
    awaitingQuery.isPending || liveQuery.isPending || pastQuery.isPending;
  const unavailable =
    awaitingQuery.data?.ponderError === "PONDER_UNAVAILABLE" ||
    liveQuery.data?.ponderError === "PONDER_UNAVAILABLE" ||
    pastQuery.data?.ponderError === "PONDER_UNAVAILABLE";

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
      <p className="text-sm text-text-secondary">Loading delegated vehicles…</p>
    );
  }

  if (
    awaiting.length === 0 &&
    attention.length === 0 &&
    liveNormal.length === 0 &&
    past.length === 0
  ) {
    return (
      <EmptyState
        variant="content"
        level="B"
        title="No delegated vehicles"
        description="When you authorize a KarPro to sell a passport, it appears here."
        className="py-8"
      />
    );
  }

  function renderConsignmentSection(
    title: string,
    rows: ConsignmentRecord[],
    attentionRows = false,
  ) {
    if (rows.length === 0) return null;
    return (
      <section className="space-y-3">
        <h2 className={cn(categoryLabel)}>{title}</h2>
        <ul className="space-y-3">
          {rows.map((row) => (
            <ConsignmentPortfolioRow
              key={row.id}
              tokenId={row.tokenId}
              chainId={row.chainId}
              href={`/marketplace/${row.tokenId}?chain=${row.chainId}`}
              statusLabel={phaseStatusLabel(row)}
              trackLabel={trackLabel(row.mode)}
              peerAddress={row.agent}
              peerLabel="Agent"
              make={row.make}
              model={row.model}
              year={row.year}
              attention={attentionRows}
              extraMeta={
                <span className="font-mono text-xs text-text-tertiary">
                  {shortChainName(row.chainId)}
                </span>
              }
            />
          ))}
        </ul>
      </section>
    );
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className={cn(categoryLabel)}>Awaiting agent</h2>
        {awaiting.length === 0 ? (
          <p className="text-sm text-text-secondary">No standing mandates.</p>
        ) : (
          <ul className="space-y-3">
            {awaiting.map((row) => (
              <ConsignmentPortfolioRow
                key={row.id}
                tokenId={row.tokenId}
                chainId={row.chainId}
                href={`/marketplace/${row.tokenId}?chain=${row.chainId}`}
                statusLabel="Mandate active"
                trackLabel={trackLabel(row.mode)}
                peerAddress={row.agent}
                peerLabel="Agent"
                extraMeta={
                  <span className="font-mono text-xs text-text-tertiary">
                    {shortChainName(row.chainId)}
                  </span>
                }
              />
            ))}
          </ul>
        )}
      </section>

      {renderConsignmentSection("Needs attention", attention, true)}
      {renderConsignmentSection("Live", liveNormal)}
      {renderConsignmentSection("Past", past)}
    </div>
  );
}
