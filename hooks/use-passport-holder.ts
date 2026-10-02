/**
 * React port for the dual-VM passport-holder owner (Unit O).
 * VM fork lives only here — chrome consumes {@link PassportHolder}.
 */

"use client";

import { useEffect, useState } from "react";

import {
  planPassportHolderRead,
  resolvePassportHolderFromPlan,
  type PassportHolder,
  type PassportHolderReadPlan,
} from "@/lib/passport/passport-holder";
import type { CommercialRegistry } from "@/lib/web3/commercial-active";
import type { ProtocolOwner } from "@/lib/web3/protocol-address";
import {
  useKeyedReadContracts,
  type KeyedContract,
} from "@/lib/web3/keyed-multicall";

type PlannedOk = Extract<PassportHolderReadPlan, { ok: true }>;

export function usePassportHolder(args: {
  namespace: number;
  tokenId: string;
  projectionOwner?: ProtocolOwner | string | null;
  transitActive?: boolean;
  enabled?: boolean;
  registry?: CommercialRegistry;
}): {
  holder: PassportHolder;
  refetch: () => void;
} {
  const {
    namespace,
    tokenId,
    projectionOwner,
    transitActive = false,
    enabled = true,
    registry,
  } = args;

  const depsKey = `${namespace}:${tokenId}:${enabled ? "1" : "0"}`;
  const [snapshot, setSnapshot] = useState<{
    key: string;
    plan: PassportHolderReadPlan;
  } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void planPassportHolderRead({ namespace, tokenId, registry }).then(
      (plan) => {
        if (cancelled) return;
        setSnapshot({ key: depsKey, plan });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [depsKey, namespace, tokenId, registry, enabled]);

  const planMatches = snapshot != null && snapshot.key === depsKey;
  const planning = enabled && !planMatches;
  const plan = planMatches ? snapshot.plan : null;
  const plannedOk: PlannedOk | null =
    plan != null && plan.ok ? plan : null;

  const contracts = (plannedOk?.contracts ?? []) as readonly KeyedContract[];
  const keyed = useKeyedReadContracts({
    contracts,
    query: {
      enabled: enabled && plannedOk != null && !transitActive,
    },
  });

  const holder = resolvePassportHolderFromPlan({
    namespace,
    plan: !enabled
      ? { ok: false, cause: "unresolved_namespace", detail: "holder_disabled" }
      : planning
        ? null
        : plan,
    planning: !enabled ? false : planning,
    entry: (key) => keyed.entry(key as never),
    batchPending: keyed.isPending,
    projectionOwner,
    transitActive,
  });

  return {
    holder,
    refetch: () => {
      void keyed.refetch();
    },
  };
}
