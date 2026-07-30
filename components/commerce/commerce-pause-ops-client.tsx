"use client";

import { CommercePauseOpsRowCard } from "@/components/commerce/commerce-pause-ops-row";
import { EmptyState } from "@/components/ui/empty-state";
import { useCommercePauseOps } from "@/hooks/use-commerce-pause-ops";

/**
 * Ops-only G3 pause grid. Not linked from ordinary navigation.
 */
export function CommercePauseOpsClient() {
  const { rows, isEmpty, isPending, refetch } = useCommercePauseOps();

  if (isEmpty) {
    return (
      <EmptyState
        variant="infrastructure"
        level="B"
        title="No commerce modes deployed"
        description="Fixed-price and ascending contracts resolve per chain after Nuclear #2. There is nothing to pause here yet."
      />
    );
  }

  if (isPending && rows.every((row) => row.paused === undefined)) {
    return (
      <p className="text-sm text-text-secondary">Loading pause state…</p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-secondary">
        Guardian may pause immediately. Unpausing is a timelock owner procedure —
        there is no unpause button on this page.
      </p>
      {rows.map((row) => (
        <CommercePauseOpsRowCard
          key={row.key}
          row={row}
          onPaused={() => {
            void refetch();
          }}
        />
      ))}
    </div>
  );
}
