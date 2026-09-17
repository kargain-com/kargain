/**
 * React port wiring for dual-VM passport commerce chrome facts (U9.2a).
 * No VM fork — the lib owner plans contracts and resolves the surface.
 */

"use client";

import { useEffect, useState } from "react";

import {
  planPassportCommerceReads,
  resolvePassportCommerceFacts,
  type PassportCommerceFacts,
  type PassportCommerceReadPlan,
} from "@/lib/passport/passport-commerce-facts";
import type { CommercialRegistry } from "@/lib/web3/commercial-active";
import {
  useKeyedReadContracts,
  type KeyedContract,
} from "@/lib/web3/keyed-multicall";

export type {
  CommerceModeFacts,
  PassportCommerceFacts,
} from "@/lib/passport/passport-commerce-facts";

export type PassportCommerceFactsResult = PassportCommerceFacts & {
  refetch: () => void;
};

export { CONSIGNMENT_PHASE } from "@/lib/commerce/consignment";

type PlannedOk = Extract<PassportCommerceReadPlan, { ok: true }>;

/**
 * One batched read of every commerce fact the passport surfaces need.
 * Missing mode addresses fail closed (not configured, never "free").
 * SVM answers custodyLocked from PassportState; other facts stay unread.
 */
export function usePassportCommerceFacts(input: {
  chainId: number;
  tokenId: string;
  enabled?: boolean;
  registry?: CommercialRegistry;
}): PassportCommerceFactsResult {
  const { chainId, tokenId, enabled = true, registry } = input;
  const depsKey = `${chainId}:${tokenId}:${enabled ? "1" : "0"}`;
  const [snapshot, setSnapshot] = useState<{
    key: string;
    plan: PlannedOk | null;
  } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void planPassportCommerceReads({
      chainId,
      tokenId,
      registry,
    }).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setSnapshot({
          key: depsKey,
          plan: {
            ok: true,
            vm: null,
            contracts: [],
            tokenId,
          },
        });
        return;
      }
      setSnapshot({ key: depsKey, plan: result });
    });
    return () => {
      cancelled = true;
    };
  }, [chainId, tokenId, registry, depsKey, enabled]);

  const plan =
    enabled && snapshot?.key === depsKey ? snapshot.plan : null;
  const planning =
    enabled && (snapshot == null || snapshot.key !== depsKey);

  const contracts: readonly KeyedContract[] = plan?.contracts ?? [];

  const reads = useKeyedReadContracts({
    contracts,
    query: {
      enabled: enabled && plan != null && contracts.length > 0,
      staleTime: 15_000,
    },
  });

  const facts = resolvePassportCommerceFacts({
    plan,
    planning,
    entry: reads.entry,
    get: reads.get,
    isPending: reads.isPending,
  });

  return {
    ...facts,
    refetch: () => {
      void reads.refetch();
    },
  };
}
