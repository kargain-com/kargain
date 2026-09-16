/**
 * React port wiring for challenge-bond deposit chrome (U6.7.3).
 * No VM fork — the disclosure owner plans contracts and resolves the amount.
 */

"use client";

import { useEffect, useState } from "react";

import {
  CHALLENGE_BOND_AMOUNT_KEY,
  planChallengeBondAmountRead,
  resolveChallengeBondAmount,
  type ChallengeBondAmountReadPlan,
} from "@/lib/passport/challenge-bond-disclosure";
import type { CommercialRegistry } from "@/lib/web3/commercial-active";
import {
  useKeyedReadContracts,
  type KeyedContract,
} from "@/lib/web3/keyed-multicall";

type PlannedOk = Extract<ChallengeBondAmountReadPlan, { ok: true }>;

export function useChallengeBondAmount(args: {
  chainId: number;
  registry?: CommercialRegistry;
  /** When false, skip the read (e.g. disclosure not configured). */
  enabled?: boolean;
}): {
  disputeDeposit: bigint | undefined;
  disputeDepositLoading: boolean;
} {
  const enabled = args.enabled !== false;
  const [snapshot, setSnapshot] = useState<{
    key: string;
    plan: PlannedOk | null;
  } | null>(null);
  const depsKey = `${args.chainId}:${enabled ? "1" : "0"}`;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void planChallengeBondAmountRead({
      chainId: args.chainId,
      registry: args.registry,
    }).then((result) => {
      if (cancelled) return;
      setSnapshot({
        key: depsKey,
        plan: result.ok ? result : null,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [args.chainId, args.registry, depsKey, enabled]);

  const plan =
    enabled && snapshot?.key === depsKey ? snapshot.plan : null;
  const planning =
    enabled && (snapshot == null || snapshot.key !== depsKey);

  const contracts: readonly KeyedContract<typeof CHALLENGE_BOND_AMOUNT_KEY>[] =
    plan?.contracts ?? [];

  const reads = useKeyedReadContracts({
    contracts,
    query: { enabled: enabled && plan != null && contracts.length > 0 },
  });

  if (!enabled) {
    return { disputeDeposit: undefined, disputeDepositLoading: false };
  }

  const resolved = resolveChallengeBondAmount({
    entry: reads.entry(CHALLENGE_BOND_AMOUNT_KEY),
    arm: plan?.arm ?? null,
    planning,
  });

  return {
    disputeDeposit: resolved.amount,
    disputeDepositLoading: resolved.loading,
  };
}
