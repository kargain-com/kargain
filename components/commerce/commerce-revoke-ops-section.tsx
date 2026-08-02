"use client";

import { CommerceRevokeTokenRowCard } from "@/components/commerce/commerce-revoke-token-row";
import { EmptyState } from "@/components/ui/empty-state";
import { useCommerceRevokeOps } from "@/hooks/use-commerce-revoke-ops";
import { RESTORE_PAYMENT_TOKEN_HINT } from "@/lib/commerce/payment-token-revoke-surface";

/**
 * G3 soft-revoke section. Candidate tokens from Ponder; CTA truth from chain.
 * No approve / restore path.
 */
export function CommerceRevokeOpsSection() {
  const { rows, isEmpty, ponderUnavailable, isPending, refetch } =
    useCommerceRevokeOps();

  if (ponderUnavailable) {
    return (
      <EmptyState
        variant="infrastructure"
        level="B"
        nested
        title="Payment tokens unavailable"
        description="The indexer did not return admitted payment tokens. Soft-revoke stays withheld until discovery resolves."
      />
    );
  }

  if (isPending && rows.length === 0) {
    return (
      <p className="text-sm text-text-secondary">Loading payment tokens…</p>
    );
  }

  if (isEmpty || rows.length === 0) {
    return (
      <p className="text-sm text-text-secondary">
        No payment tokens indexed for deployed modes yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-secondary">
        Guardian may soft-revoke an admitted asset immediately. New opens in that
        asset stop; in-flight deals still settle. {RESTORE_PAYMENT_TOKEN_HINT}
      </p>
      {rows.map((row) => (
        <CommerceRevokeTokenRowCard
          key={row.key}
          row={row}
          onRevoked={() => {
            void refetch();
          }}
        />
      ))}
    </div>
  );
}
