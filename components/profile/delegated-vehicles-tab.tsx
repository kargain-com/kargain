"use client";

import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { erc20Abi } from "viem";
import { useReadContract } from "wagmi";

import { getConsignments } from "@/app/actions/commerce-consignments";
import { getOwnerMandates } from "@/app/actions/commerce-mandates";
import { OwnerLowerFloorPanel } from "@/components/commerce/owner-lower-floor-panel";
import { OwnerMandateTerms } from "@/components/commerce/owner-mandate-terms";
import { ConsignmentPortfolioRow } from "@/components/consignment/consignment-portfolio-row";
import { EmptyState } from "@/components/ui/empty-state";
import { isZeroAddress } from "@/lib/commerce/consignment";
import { DENOMINATION_KIND } from "@/lib/commerce/denomination";
import { floorDisplayUnits } from "@/lib/commerce/floor-display";
import { commerceModeAddress } from "@/lib/commerce/mode";
import { deriveOwnerMandateReadout } from "@/lib/commerce/owner-mandate-readout";
import type {
  ConsignmentRecord,
  MandateRecord,
} from "@/lib/commerce/ponder-consignment";
import { categoryLabel } from "@/lib/design/instrument-classes";
import { resolveKarProTargetChainId } from "@/lib/kar-pro/kar-pro-target-chain";
import { shortChainName, wagmiChainId } from "@/lib/web3/supported-chains";
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

type MoneyRow = {
  chainId: number;
  asset: `0x${string}`;
  denominationKind: typeof DENOMINATION_KIND.Asset | typeof DENOMINATION_KIND.Fiat;
  currencyCode: string;
};

function useFloorUnits(row: MoneyRow) {
  const needsErc20 =
    row.denominationKind === DENOMINATION_KIND.Asset &&
    Boolean(row.asset) &&
    !isZeroAddress(row.asset);
  const { data: erc20Decimals } = useReadContract({
    address: row.asset,
    abi: erc20Abi,
    functionName: "decimals",
    chainId: wagmiChainId(row.chainId),
    query: { enabled: needsErc20 },
  });
  return floorDisplayUnits({
    denominationKind: row.denominationKind,
    currencyCode: row.currencyCode,
    asset: row.asset,
    erc20Decimals:
      typeof erc20Decimals === "number" ? erc20Decimals : undefined,
  });
}

function DelegatedMandateTerms({ row }: { row: MandateRecord }) {
  const units = useFloorUnits(row);
  const readout = deriveOwnerMandateReadout({
    compensationForm: row.compensationForm,
    commissionBps: row.commissionBps,
    floor: row.floor,
    units,
    mode: row.mode,
  });
  return <OwnerMandateTerms readout={readout} />;
}

function DelegatedConsignmentTerms({
  row,
  /** Live consignments may show variable Commission proceeds (S32 formula). */
  allowVariableProceeds,
}: {
  row: ConsignmentRecord;
  allowVariableProceeds: boolean;
}) {
  const units = useFloorUnits(row);
  const readout = deriveOwnerMandateReadout({
    compensationForm: row.compensationForm,
    commissionBps: row.commissionBps,
    floor: row.floor,
    units,
    mode: row.mode,
    settled: allowVariableProceeds ? row.price : null,
    platformFeeBps: allowVariableProceeds ? row.platformFeeBps : null,
  });
  return <OwnerMandateTerms readout={readout} />;
}

function DelegatedLiveFloor({
  row,
  onChanged,
}: {
  row: ConsignmentRecord;
  onChanged: () => void;
}) {
  const hasAgent = Boolean(row.agent && !isZeroAddress(row.agent));
  const units = useFloorUnits(row);

  if (!hasAgent || !units) return null;

  return (
    <OwnerLowerFloorPanel
      mode={row.mode}
      chainId={row.chainId}
      tokenId={row.tokenId}
      live={true}
      isPassportOwner={true}
      snapshotFloor={row.floor}
      floorDecimals={units.decimals}
      floorUnitLabel={units.unitLabel}
      compensationForm={row.compensationForm}
      onChanged={onChanged}
    />
  );
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

  const refresh = () => {
    void awaitingQuery.refetch();
    void liveQuery.refetch();
    void pastQuery.refetch();
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
    options: { attention?: boolean; live?: boolean; past?: boolean } = {},
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
              attention={options.attention === true}
              extraMeta={
                <span className="font-mono text-xs text-text-tertiary">
                  {shortChainName(row.chainId)}
                </span>
              }
            >
              <DelegatedConsignmentTerms
                row={row}
                allowVariableProceeds={options.live === true}
              />
              {options.live === true &&
                (row.phase === "offered" || row.phase === "binding") && (
                  <DelegatedLiveFloor row={row} onChanged={refresh} />
                )}
            </ConsignmentPortfolioRow>
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
              >
                <DelegatedMandateTerms row={row} />
              </ConsignmentPortfolioRow>
            ))}
          </ul>
        )}
      </section>

      {renderConsignmentSection("Needs attention", attention, {
        attention: true,
        live: true,
      })}
      {renderConsignmentSection("Live", liveNormal, { live: true })}
      {renderConsignmentSection("Past", past, { past: true })}
    </div>
  );
}
