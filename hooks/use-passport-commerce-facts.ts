/**
 * React port wiring for dual-VM passport commerce chrome facts (U9.2a / S8-D1 / 9.3c).
 * No VM fork in components — the lib owner plans contracts and resolves the surface;
 * May permissions on SVM come from simulatePassportMay with the session fee payer.
 */

"use client";

import { useEffect, useMemo, useState } from "react";

import { useActiveAccount } from "@/hooks/use-active-account";
import {
  PASSPORT_CONFIG_KEY,
  planPassportCommerceReads,
  resolvePassportCommerceFacts,
  type PassportCommerceFacts,
  type PassportCommerceReadPlan,
} from "@/lib/passport/passport-commerce-facts";
import type { EncumbrancePermissionGate } from "@/lib/passport/encumbrance-permission";
import {
  decideMaySimulate,
  simulatePassportMayPermissions,
} from "@/lib/passport/simulate-passport-may";
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

type MayPermissions = {
  openConsignmentPermission: EncumbrancePermissionGate;
  leaveChainPermission: EncumbrancePermissionGate;
};

const PENDING_MAY: MayPermissions = {
  openConsignmentPermission: { status: "blocked", cause: "reads_unresolved" },
  leaveChainPermission: { status: "blocked", cause: "reads_unresolved" },
};

/**
 * One batched read of every commerce fact the passport surfaces need.
 * Missing mode addresses fail closed (not configured, never "free").
 * SVM answers phase/mandate/challenge/registry from mode+passport accounts;
 * may_* from PassportIx::May simulation (session fee payer required).
 */
export function usePassportCommerceFacts(input: {
  chainId: number;
  tokenId: string;
  enabled?: boolean;
  registry?: CommercialRegistry;
}): PassportCommerceFactsResult {
  const { chainId, tokenId, enabled = true, registry } = input;
  const { account } = useActiveAccount();
  const depsKey = `${chainId}:${tokenId}:${enabled ? "1" : "0"}`;
  const [snapshot, setSnapshot] = useState<{
    key: string;
    plan: PlannedOk | null;
  } | null>(null);
  const [mayAsync, setMayAsync] = useState<{
    key: string;
    value: MayPermissions;
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

  const configEntry = reads.entry(PASSPORT_CONFIG_KEY);

  const mayDecision = useMemo(
    () =>
      decideMaySimulate({
        enabled,
        planVm: plan?.vm,
        planNamespace:
          plan != null && "namespace" in plan ? plan.namespace : undefined,
        planTokenId: plan?.tokenId,
        planning,
        batchPending: reads.isPending,
        account,
        depsKey,
        configEntry,
        registry,
      }),
    [
      enabled,
      plan,
      planning,
      reads.isPending,
      account,
      depsKey,
      configEntry,
      registry,
    ],
  );

  const simulateArgs =
    mayDecision.kind === "simulate" ? mayDecision : null;

  useEffect(() => {
    if (simulateArgs == null) return;
    const { key, stack, tokenId: tid, feePayer, sources } = simulateArgs;
    let cancelled = false;
    void simulatePassportMayPermissions({
      stack,
      tokenId: tid,
      feePayer,
      sources,
    }).then((perms) => {
      if (cancelled) return;
      setMayAsync({ key, value: perms });
    });
    return () => {
      cancelled = true;
    };
    // Depend on mayKey fields, not object identity of simulateArgs (rebuilt each memo).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key/feePayer/tokenId/sources/stack
  }, [
    simulateArgs?.key,
    simulateArgs?.feePayer,
    simulateArgs?.tokenId,
    simulateArgs?.sources,
    simulateArgs?.stack,
  ]);

  const injectedMay: MayPermissions | undefined =
    mayDecision.kind === "omit"
      ? undefined
      : mayDecision.kind === "ready"
        ? mayDecision.value
        : mayAsync?.key === mayDecision.key
          ? mayAsync.value
          : PENDING_MAY;

  const facts = resolvePassportCommerceFacts({
    plan,
    planning,
    entry: reads.entry,
    get: reads.get,
    isPending: reads.isPending,
    namespace: chainId,
    registry,
    mayPermissions: injectedMay,
  });

  return {
    ...facts,
    refetch: () => {
      void reads.refetch();
    },
  };
}
