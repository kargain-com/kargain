"use client";

import { ShieldWarningIcon } from "@/components/ui/icons";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useAccount } from "wagmi";

import { ChallengeRow, ChallengeRowSkeleton } from "@/components/challenges/challenge-row";
import { EmptyState } from "@/components/ui/empty-state";
import { WalletLoginButton } from "@/components/wallet-login-button";
import { useChallenges } from "@/hooks/use-challenges";
import { isChallengeUnresolved } from "@/lib/commerce/challenge-display";
import type {
  ChallengeInstance,
  ChallengeRecord,
} from "@/lib/commerce/ponder-consignment";
import { ctaLink, serialLabel } from "@/lib/design/instrument-classes";
import { cn } from "@/lib/utils";

type FilterId = "unresolved" | "passport" | "ascending" | "mine";

const FILTER_OPTIONS: { id: FilterId; label: string }[] = [
  { id: "unresolved", label: "Needs action" },
  { id: "passport", label: "Verification" },
  { id: "ascending", label: "Auction settlement" },
  { id: "mine", label: "Opened by me" },
];

function filterChallenges(
  rows: ChallengeRecord[],
  filter: FilterId,
  viewer: string | undefined,
): ChallengeRecord[] {
  switch (filter) {
    case "unresolved":
      return rows.filter((row) => isChallengeUnresolved(row.status));
    case "passport":
      return rows.filter((row) => row.instance === "passport");
    case "ascending":
      return rows.filter((row) => row.instance === "ascending");
    case "mine":
      if (!viewer) return [];
      return rows.filter(
        (row) => row.challenger.toLowerCase() === viewer.toLowerCase(),
      );
  }
}

export function ChallengesClient() {
  const { address, isConnected } = useAccount();
  const [filter, setFilter] = useState<FilterId>("unresolved");

  const instanceParam: ChallengeInstance | undefined =
    filter === "passport"
      ? "passport"
      : filter === "ascending"
        ? "ascending"
        : undefined;

  const { data, isLoading, isError } = useChallenges(
    {
      instance: instanceParam,
      limit: 48,
      unresolved: filter === "unresolved",
    },
    isConnected,
  );

  const rows = useMemo(() => {
    const base = data?.rows ?? [];
    if (filter === "mine") {
      return filterChallenges(base, "mine", address);
    }
    if (filter === "unresolved") {
      return base.filter((row) => isChallengeUnresolved(row.status));
    }
    return base;
  }, [data?.rows, filter, address]);

  if (!isConnected) {
    return (
      <div className="mt-8 space-y-3">
        <EmptyState
          variant="infrastructure"
          level="B"
          title="Connect your wallet to see open challenges."
        />
        <WalletLoginButton />
      </div>
    );
  }

  return (
    <div className="mt-8 space-y-4">
      <p className="font-sans text-sm text-text-secondary">
        Bonded challenges on passport verification and auction settlement. Resolve
        them on each passport&apos;s Actions tab or on the lot settlement panel.
      </p>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Challenge filters">
        {FILTER_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={filter === option.id}
            onClick={() => setFilter(option.id)}
            className={cn(
              "rounded-sm border px-3 py-1.5 font-sans text-xs transition-colors duration-150",
              "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
              filter === option.id
                ? "border-border-default bg-bg-surface text-text-primary"
                : "border-transparent text-text-secondary hover:text-text-primary",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {data?.ponderError === "PONDER_UNAVAILABLE" && (
        <EmptyState
          variant="infrastructure"
          level="B"
          title="Challenge feed is temporarily unavailable."
          role="alert"
        />
      )}

      {isLoading && (
        <ul className="space-y-3" aria-busy="true">
          {Array.from({ length: 3 }, (_, i) => (
            <li key={i}>
              <ChallengeRowSkeleton />
            </li>
          ))}
        </ul>
      )}

      {!isLoading && !isError && data?.ponderError !== "PONDER_UNAVAILABLE" && rows.length === 0 && (
        <EmptyState
          variant="content"
          level="A"
          icon={ShieldWarningIcon}
          title="No challenges in this view"
          description="Open verification or settlement challenges will appear here when indexed."
        />
      )}

      {!isLoading && rows.length > 0 && (
        <ul className="space-y-3">
          {rows.map((challenge) => (
            <li key={challenge.id}>
              <ChallengeRow challenge={challenge} />
            </li>
          ))}
        </ul>
      )}

      {!isLoading && rows.length > 0 && (
        <p className={cn(serialLabel, "text-center")}>
          Showing {rows.length}
          {data?.total != null && data.total > rows.length
            ? ` of ${data.total} indexed`
            : ""}
        </p>
      )}
    </div>
  );
}
