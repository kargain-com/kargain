"use client";

import { ShieldWarningIcon } from "@/components/ui/icons";
import { useMemo, useState } from "react";
import { useAccount } from "wagmi";

import { ChallengeRow, ChallengeRowSkeleton } from "@/components/challenges/challenge-row";
import { EmptyState } from "@/components/ui/empty-state";
import { WalletLoginButton } from "@/components/wallet-login-button";
import { useChallenges } from "@/hooks/use-challenges";
import {
  CHALLENGE_BROWSE_FILTER_OPTIONS,
  challengeBrowseFilterToQuery,
  type ChallengeBrowseFilterId,
} from "@/lib/challenge/browse-filters";
import { serialLabel } from "@/lib/design/instrument-classes";
import { cn } from "@/lib/utils";

export function ChallengesClient() {
  const { address, isConnected } = useAccount();
  const [filter, setFilter] = useState<ChallengeBrowseFilterId>("unresolved");

  const browse = useMemo(
    () => challengeBrowseFilterToQuery(filter, address),
    [filter, address],
  );

  const { data, isLoading, isError } = useChallenges(
    browse.ok ? { ...browse.query, limit: 48 } : {},
    isConnected && browse.ok,
  );

  const rows = data?.rows ?? [];

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
        {CHALLENGE_BROWSE_FILTER_OPTIONS.map((option) => (
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
