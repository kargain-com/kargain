"use client";

import { useMemo } from "react";
import { useAccount } from "wagmi";
import type { Address } from "viem";

import {
  COMMERCE_MODES,
  commerceModeAbi,
  commerceModeAddress,
} from "@/lib/commerce/mode";
import { normalizeAddress } from "@/lib/commerce/pause-surface";
import { commercialChainIds } from "@/lib/web3/chain-context";
import { useKeyedReadContracts } from "@/lib/web3/keyed-multicall";
import { wagmiChainId } from "@/lib/web3/supported-chains";

const STALE_MS = 30_000;

/**
 * True when the connected wallet is `guardian()` on any resolved commerce mode.
 * Used only for the quiet ops link — not for write gating (ops panel re-reads).
 */
export function useIsCommerceGuardian(enabled = true): {
  isGuardian: boolean;
  isPending: boolean;
} {
  const { address: connected } = useAccount();

  const targets = useMemo(() => {
    const out: {
      chainId: number;
      address: Address;
      mode: (typeof COMMERCE_MODES)[number];
    }[] = [];
    for (const chainId of commercialChainIds()) {
      for (const mode of COMMERCE_MODES) {
        const address = commerceModeAddress(mode, chainId);
        if (address) out.push({ chainId, mode, address });
      }
    }
    return out;
  }, []);

  const contracts = useMemo(
    () =>
      targets.map(({ chainId, mode, address }) => ({
        key: `${chainId}:${mode}:guardian`,
        address,
        abi: commerceModeAbi(mode),
        functionName: "guardian" as const,
        chainId: wagmiChainId(chainId),
      })),
    [targets],
  );

  const reads = useKeyedReadContracts({
    contracts,
    query: {
      enabled: Boolean(enabled && connected && targets.length > 0),
      staleTime: STALE_MS,
    },
  });

  const connectedNorm = normalizeAddress(connected);
  const isGuardian = useMemo(() => {
    if (!connectedNorm) return false;
    return reads.entries.some((entry) => {
      if (entry?.status !== "success") return false;
      const g = normalizeAddress(entry.result as string);
      return g != null && g === connectedNorm;
    });
  }, [reads.entries, connectedNorm]);

  return {
    isGuardian,
    isPending: Boolean(
      enabled && connected && targets.length > 0 && reads.isPending,
    ),
  };
}
