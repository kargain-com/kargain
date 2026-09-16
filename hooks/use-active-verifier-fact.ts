/**
 * React port wiring for the dual-VM active-verifier admission fact.
 * No VM fork — the lib owner plans contracts and resolves the tri-state.
 */

"use client";

import { useEffect, useState } from "react";

import { useActiveAccount } from "@/hooks/use-active-account";
import {
  ACTIVE_VERIFIER_FACT_KEY,
  activeVerifierToBooleanOrUndefined,
  planActiveVerifierRead,
  resolveActiveVerifierFact,
  type ActiveVerifierFact,
  type ActiveVerifierReadPlan,
} from "@/lib/verifier/active-verifier-fact";
import type { CommercialRegistry } from "@/lib/web3/commercial-active";
import {
  useKeyedReadContracts,
  type KeyedContract,
} from "@/lib/web3/keyed-multicall";

type PlannedOk = Extract<ActiveVerifierReadPlan, { ok: true }>;

function accountPlanKey(
  account: ReturnType<typeof useActiveAccount>["account"],
  chainId: number,
): string {
  if (account.status !== "connected") {
    return `disconnected:${chainId}`;
  }
  return `${account.vm}:${account.address}:${chainId}`;
}

export function useActiveVerifierFact(args: {
  chainId: number;
  registry?: CommercialRegistry;
}): {
  fact: ActiveVerifierFact;
  /** Legacy `boolean | undefined` for action-surface / obligation derive. */
  isActiveVerifier: boolean | undefined;
} {
  const { account } = useActiveAccount();
  const depsKey = accountPlanKey(account, args.chainId);
  const [snapshot, setSnapshot] = useState<{
    key: string;
    plan: PlannedOk;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void planActiveVerifierRead({
      account,
      chainId: args.chainId,
      registry: args.registry,
    }).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        // PDA failure with a bound session → leave unresolved (fail closed unread).
        setSnapshot({
          key: depsKey,
          plan: {
            ok: true,
            sessionBound: true,
            contracts: [],
            vm: "svm",
          },
        });
        return;
      }
      setSnapshot({ key: depsKey, plan: result });
    });
    return () => {
      cancelled = true;
    };
  }, [account, args.chainId, args.registry, depsKey]);

  const plan = snapshot?.key === depsKey ? snapshot.plan : null;
  const planning = plan == null;

  const contracts: readonly KeyedContract<typeof ACTIVE_VERIFIER_FACT_KEY>[] =
    plan?.sessionBound === true ? plan.contracts : [];

  const reads = useKeyedReadContracts({
    contracts,
    query: { enabled: plan?.sessionBound === true && contracts.length > 0 },
  });

  const fact = resolveActiveVerifierFact({
    entry: reads.entry(ACTIVE_VERIFIER_FACT_KEY),
    sessionBound: plan?.sessionBound === true,
    planning,
    vm: plan?.vm ?? null,
  });

  return {
    fact,
    isActiveVerifier: activeVerifierToBooleanOrUndefined(fact),
  };
}
