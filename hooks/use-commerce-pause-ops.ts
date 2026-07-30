"use client";

import { useMemo } from "react";
import { useAccount, useReadContracts } from "wagmi";
import type { Address } from "viem";

import {
  COMMERCE_MODES,
  commerceModeAbi,
  commerceModeAddress,
  commerceModeLabel,
  type CommerceMode,
} from "@/lib/commerce/mode";
import {
  deriveGuardianPauseControl,
  normalizeAddress,
  type GuardianPauseControl,
} from "@/lib/commerce/pause-surface";
import { commercialChainIds } from "@/lib/web3/chain-context";
import { shortChainName, wagmiChainId } from "@/lib/web3/supported-chains";

const STALE_MS = 15_000;

export type CommercePauseOpsRow = {
  key: string;
  chainId: number;
  chainLabel: string;
  mode: CommerceMode;
  modeLabel: string;
  address: Address;
  paused: boolean | undefined;
  guardian: Address | undefined;
  owner: Address | undefined;
  control: GuardianPauseControl;
};

type ContractReadResult =
  | { status: "success"; result: unknown }
  | { status: "failure"; error: unknown };

type Target = {
  chainId: number;
  mode: CommerceMode;
  address: Address;
};

/**
 * Ops grid: every commercial chain × registered mode whose address resolves.
 * Reads `paused` / `guardian` / `owner` from chain only.
 */
export function useCommercePauseOps() {
  const { address: connected } = useAccount();

  const targets = useMemo((): Target[] => {
    const out: Target[] = [];
    for (const chainId of commercialChainIds()) {
      for (const mode of COMMERCE_MODES) {
        const address = commerceModeAddress(mode, chainId);
        if (address) out.push({ chainId, mode, address });
      }
    }
    return out;
  }, []);

  const contracts = useMemo(() => {
    return targets.flatMap(({ chainId, mode, address }) => {
      const wc = wagmiChainId(chainId);
      const abi = commerceModeAbi(mode);
      return (
        ["paused", "guardian", "owner"] as const
      ).map((functionName) => ({
        address,
        abi,
        functionName,
        chainId: wc,
      }));
    });
  }, [targets]);

  const { data, isPending, isFetching, refetch } = useReadContracts({
    contracts,
    query: {
      enabled: targets.length > 0,
      staleTime: STALE_MS,
    },
  });

  const results = data as ReadonlyArray<ContractReadResult> | undefined;

  const rows: CommercePauseOpsRow[] = useMemo(() => {
    return targets.map((target, i) => {
      const base = i * 3;
      const pausedEntry = results?.[base];
      const guardianEntry = results?.[base + 1];
      const ownerEntry = results?.[base + 2];
      const paused =
        pausedEntry?.status === "success"
          ? pausedEntry.result === true
          : undefined;
      const guardian =
        guardianEntry?.status === "success"
          ? normalizeAddress(guardianEntry.result as string)
          : undefined;
      const owner =
        ownerEntry?.status === "success"
          ? normalizeAddress(ownerEntry.result as string)
          : undefined;
      return {
        key: `${target.chainId}-${target.mode}`,
        chainId: target.chainId,
        chainLabel: shortChainName(target.chainId),
        mode: target.mode,
        modeLabel: commerceModeLabel(target.mode),
        address: target.address,
        paused,
        guardian,
        owner,
        control: deriveGuardianPauseControl({
          connected,
          guardian,
          owner,
          paused,
        }),
      };
    });
  }, [targets, results, connected]);

  const isGuardianOnAny = rows.some((row) => row.control.role === "guardian");

  return {
    rows,
    isEmpty: targets.length === 0,
    isPending: targets.length > 0 && isPending,
    isFetching,
    isGuardianOnAny,
    refetch,
  };
}
