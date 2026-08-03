"use client";

import { useMemo } from "react";
import type { Address } from "viem";

import { KarProStakingAbi } from "@/lib/contracts/abis.generated";
import {
  foldAnyActiveByAddress,
  karProMembershipActiveKey,
} from "@/lib/kar-pro/membership-roster";
import { commercialChainIds } from "@/lib/web3/chain-context";
import { karProStakingAddress } from "@/lib/web3/deployment-addresses";
import {
  useKeyedReadContracts,
  type KeyedContract,
} from "@/lib/web3/keyed-multicall";
import { wagmiChainId } from "@/lib/web3/supported-chains";

/**
 * Sole client owner of multi-address “KarPro somewhere” (anyActive) reads.
 * Commons reviews/confirmations and peer badges without a chain consume this —
 * do not duplicate commercial OR loops elsewhere.
 */
export function useKarProMembershipActive(
  addresses: readonly Address[],
  options?: { enabled?: boolean },
): {
  activeByAddress: Map<string, boolean>;
  isPending: boolean;
  /** True when there are contracts to wait on. */
  hasContracts: boolean;
} {
  const enabled = options?.enabled ?? true;

  const addressKey = useMemo(() => {
    const deduped = [...new Set(addresses.map((a) => a.toLowerCase()))];
    deduped.sort();
    return deduped.join(",");
  }, [addresses]);

  const attesters = useMemo(
    () => (addressKey ? (addressKey.split(",") as Address[]) : []),
    [addressKey],
  );

  const chainIds = useMemo(
    () => commercialChainIds().filter((cid) => Boolean(karProStakingAddress(cid))),
    [],
  );

  const contracts = useMemo((): KeyedContract[] => {
    if (!enabled || attesters.length === 0) return [];
    const out: KeyedContract[] = [];
    for (const cid of chainIds) {
      const staking = karProStakingAddress(cid);
      if (!staking) continue;
      for (const attester of attesters) {
        out.push({
          key: karProMembershipActiveKey(cid, attester.toLowerCase()),
          address: staking,
          abi: KarProStakingAbi,
          functionName: "isActiveVerifier",
          args: [attester],
          chainId: wagmiChainId(cid),
        });
      }
    }
    return out;
  }, [enabled, attesters, chainIds]);

  const reads = useKeyedReadContracts({
    contracts,
    query: { enabled: contracts.length > 0 },
  });

  const activeByAddress = useMemo(() => {
    if (reads.isPending && contracts.length > 0) {
      return foldAnyActiveByAddress({
        addresses: attesters,
        commercialChainIds: chainIds,
        isActiveOnChain: () => undefined,
      });
    }
    return foldAnyActiveByAddress({
      addresses: attesters,
      commercialChainIds: chainIds,
      isActiveOnChain: (cid, addressLower) => {
        const raw = reads.get(karProMembershipActiveKey(cid, addressLower));
        return raw === true ? true : raw === false ? false : undefined;
      },
    });
  }, [attesters, chainIds, contracts.length, reads]);

  return {
    activeByAddress,
    isPending: contracts.length > 0 && reads.isPending,
    hasContracts: contracts.length > 0,
  };
}
