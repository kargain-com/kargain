"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import type { Address } from "viem";

import { getCommercePaymentTokenCandidates } from "@/app/actions/commerce-payment-tokens";
import { useCommercePauseOps } from "@/hooks/use-commerce-pause-ops";
import {
  commerceModeAbi,
  type CommerceMode,
} from "@/lib/commerce/mode";
import {
  deriveGuardianRevokeControl,
  normalizeRevokeAddress,
  type GuardianRevokeControl,
} from "@/lib/commerce/payment-token-revoke-surface";
import {
  useKeyedReadContracts,
  type KeyedContract,
} from "@/lib/web3/keyed-multicall";
import { shortAddress } from "@/lib/web3/wallet-display";
import { shortChainName, wagmiChainId } from "@/lib/web3/supported-chains";

const STALE_MS = 15_000;

export type CommerceRevokeTokenRow = {
  key: string;
  chainId: number;
  chainLabel: string;
  mode: CommerceMode;
  modeLabel: string;
  modeAddress: Address;
  token: Address;
  tokenLabel: string;
  decimals: number;
  /** Chain-sourced; undefined while unread. */
  enabled: boolean | undefined;
  guardian: Address | undefined;
  owner: Address | undefined;
  control: GuardianRevokeControl;
};

function parseChainEnabled(
  mode: CommerceMode,
  result: unknown,
): boolean | undefined {
  if (result === undefined || result === null) return undefined;
  if (mode === "ascending") {
    return result === true;
  }
  if (Array.isArray(result)) {
    return Boolean(result[2]);
  }
  if (typeof result === "object" && "enabled" in result) {
    return Boolean((result as { enabled: boolean }).enabled);
  }
  return undefined;
}

/**
 * Ops soft-revoke grid: Ponder candidate list + chain `enabled` + guardian gate.
 * Reuses pause ops mode/guardian/owner reads; never offers approve.
 */
export function useCommerceRevokeOps() {
  const { address: connected } = useAccount();
  const pause = useCommercePauseOps();

  const ponderQuery = useQuery({
    queryKey: ["commerce-payment-tokens", "ops-revoke"],
    queryFn: () => getCommercePaymentTokenCandidates(),
    staleTime: STALE_MS,
  });

  const modeByKey = useMemo(() => {
    const map = new Map<
      string,
      {
        chainId: number;
        mode: CommerceMode;
        modeLabel: string;
        address: Address;
        guardian: Address | undefined;
        owner: Address | undefined;
      }
    >();
    for (const row of pause.rows) {
      map.set(`${row.chainId}:${row.address.toLowerCase()}`, {
        chainId: row.chainId,
        mode: row.mode,
        modeLabel: row.modeLabel,
        address: row.address,
        guardian: row.guardian,
        owner: row.owner,
      });
    }
    return map;
  }, [pause.rows]);

  const candidates = useMemo(() => {
    const tokens = ponderQuery.data?.tokens ?? [];
    const out: Array<{
      chainId: number;
      mode: CommerceMode;
      modeLabel: string;
      modeAddress: Address;
      token: Address;
      decimals: number;
      guardian: Address | undefined;
      owner: Address | undefined;
    }> = [];
    for (const row of tokens) {
      const modeRow = modeByKey.get(
        `${row.chainId}:${row.modeContract.toLowerCase()}`,
      );
      if (!modeRow) continue;
      if (row.mode !== modeRow.mode) continue;
      const token = normalizeRevokeAddress(row.token);
      if (!token) continue;
      out.push({
        chainId: modeRow.chainId,
        mode: modeRow.mode,
        modeLabel: modeRow.modeLabel,
        modeAddress: modeRow.address,
        token,
        decimals: row.decimals,
        guardian: modeRow.guardian,
        owner: modeRow.owner,
      });
    }
    // Stable order: chain → mode → token
    out.sort((a, b) => {
      if (a.chainId !== b.chainId) return a.chainId - b.chainId;
      if (a.mode !== b.mode) return a.mode.localeCompare(b.mode);
      return a.token.localeCompare(b.token);
    });
    return out;
  }, [ponderQuery.data, modeByKey]);

  const contracts = useMemo((): KeyedContract[] => {
    return candidates.map((c) => {
      const wc = wagmiChainId(c.chainId);
      const abi = commerceModeAbi(c.mode);
      if (c.mode === "fixedPrice") {
        return {
          key: `${c.chainId}:${c.mode}:${c.token}:paymentTokens`,
          address: c.modeAddress,
          abi,
          functionName: "paymentTokens",
          args: [c.token] as const,
          chainId: wc,
        };
      }
      return {
        key: `${c.chainId}:${c.mode}:${c.token}:paymentTokenEnabled`,
        address: c.modeAddress,
        abi,
        functionName: "paymentTokenEnabled",
        args: [c.token] as const,
        chainId: wc,
      };
    });
  }, [candidates]);

  const reads = useKeyedReadContracts({
    contracts,
    query: {
      enabled: candidates.length > 0,
      staleTime: STALE_MS,
    },
  });

  const rows: CommerceRevokeTokenRow[] = useMemo(() => {
    return candidates.map((c) => {
      const readKey =
        c.mode === "fixedPrice"
          ? `${c.chainId}:${c.mode}:${c.token}:paymentTokens`
          : `${c.chainId}:${c.mode}:${c.token}:paymentTokenEnabled`;
      const entry = reads.entry(readKey);
      const enabled =
        entry?.status === "success"
          ? parseChainEnabled(c.mode, entry.result)
          : undefined;
      return {
        key: `${c.chainId}-${c.mode}-${c.token}`,
        chainId: c.chainId,
        chainLabel: shortChainName(c.chainId),
        mode: c.mode,
        modeLabel: c.modeLabel,
        modeAddress: c.modeAddress,
        token: c.token,
        tokenLabel: shortAddress(c.token),
        decimals: c.decimals,
        enabled,
        guardian: c.guardian,
        owner: c.owner,
        control: deriveGuardianRevokeControl({
          connected,
          guardian: c.guardian,
          owner: c.owner,
          enabled,
        }),
      };
    });
  }, [candidates, reads, connected]);

  return {
    rows,
    isEmpty: !pause.isEmpty && candidates.length === 0 && ponderQuery.isSuccess,
    ponderUnavailable: ponderQuery.data?.ponderError === "PONDER_UNAVAILABLE",
    isPending:
      pause.isPending ||
      ponderQuery.isPending ||
      (candidates.length > 0 && reads.isPending),
    refetch: async () => {
      await Promise.all([pause.refetch(), ponderQuery.refetch(), reads.refetch()]);
    },
  };
}
