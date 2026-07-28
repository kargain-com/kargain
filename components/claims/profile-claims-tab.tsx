"use client";

import { useWriteContract } from "wagmi";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useClaimAssetMeta } from "@/hooks/use-claim-asset-meta";
import { usePendingClaims } from "@/hooks/use-pending-claims";
import { TX_SYNC_LAG_ADVISORY, useTxSync } from "@/hooks/use-tx-sync";
import { claimablePayoutsAbi } from "@/lib/claims/claimable-payouts-abi";
import { formatClaimAmount } from "@/lib/claims/format-claim-amount";
import { explainClaimFromCredits } from "@/lib/claims/explain-credits";
import type { PendingClaimView } from "@/lib/claims/map-pending-claim";
import { monoNumeric } from "@/lib/design/instrument-classes";
import { shortChainName } from "@/lib/web3/supported-chains";
import { cn } from "@/lib/utils";
import { CreditCardIcon } from "@/components/ui/icons";

function ClaimRow({ claim }: { claim: PendingClaimView }) {
  const { writeContractAsync } = useWriteContract();
  const { runTx, busy, error, syncLagged } = useTxSync(claim.chainId);
  const meta = useClaimAssetMeta({
    chainId: claim.chainId,
    asset: claim.asset,
    isNative: claim.isNative,
  });

  const amountLabel = formatClaimAmount({
    amount: claim.amount,
    decimals: meta.decimals,
    symbol: meta.symbol,
    nativeSymbol: meta.nativeSymbol,
    isNative: claim.isNative,
  });

  const reasonExplanation = explainClaimFromCredits(
    claim.credits.map((c) => ({
      amount: c.amount,
      reasonCode: c.reasonCode,
      asset: claim.asset,
    })),
    {
      decimals: meta.decimals,
      symbol: meta.symbol,
      nativeSymbol: meta.nativeSymbol,
    },
  );

  const onWithdraw = () => {
    void runTx(() =>
      writeContractAsync({
        address: claim.contract,
        abi: claimablePayoutsAbi,
        functionName: "withdrawClaim",
        args: [claim.asset],
        chainId: claim.chainId,
      }),
    );
  };

  return (
    <li className="flex flex-col gap-3 border-b border-border-default py-4 last:border-b-0">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <p className={cn(monoNumeric, "text-base")}>{amountLabel}</p>
        <p className="font-mono text-xs text-text-tertiary tabular-nums">
          {shortChainName(claim.chainId)}
        </p>
      </div>
      <p className="text-sm text-text-secondary">
        Owed by {claim.roleLabel}
        <span className="font-mono text-xs text-text-tertiary"> · {claim.contract}</span>
      </p>
      <p className="whitespace-pre-line text-sm text-text-primary">{reasonExplanation}</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button
          type="button"
          size="sm"
          disabled={busy}
          onClick={onWithdraw}
        >
          {busy ? "Withdrawing…" : "Withdraw"}
        </Button>
        {error ? (
          <p className="text-sm text-status-error" role="alert">
            {error}
          </p>
        ) : null}
        {syncLagged ? (
          <p className="text-xs text-text-tertiary">{TX_SYNC_LAG_ADVISORY}</p>
        ) : null}
      </div>
    </li>
  );
}

export function ProfileClaimsTab() {
  const { claims, total, isLoading, ponderError } = usePendingClaims();

  if (isLoading) {
    return (
      <p className="text-sm text-text-secondary" role="status">
        Loading claims…
      </p>
    );
  }

  if (ponderError) {
    return (
      <EmptyState
        variant="infrastructure"
        level="B"
        icon={CreditCardIcon}
        title="Claims unavailable"
        description="The indexer could not be reached. Try again shortly."
      />
    );
  }

  if (total === 0 || claims.length === 0) {
    return (
      <EmptyState
        variant="content"
        level="B"
        icon={CreditCardIcon}
        title="No pending claims"
        description="When a payout cannot reach your wallet, it appears here for you to withdraw."
      />
    );
  }

  return (
    <ul className="divide-y-0">
      {claims.map((claim) => (
        <ClaimRow key={claim.id} claim={claim} />
      ))}
    </ul>
  );
}
