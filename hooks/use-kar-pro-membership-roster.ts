"use client";

import { KarProStakingAbi } from "@/lib/contracts/abis.generated";
import {
  deriveKarProMembershipRoster,
  type KarProMembershipRow,
} from "@/lib/kar-pro/membership-roster";
import { commercialChainIds } from "@/lib/web3/chain-context";
import { karProStakingAddress } from "@/lib/web3/deployment-addresses";
import { useKeyedReadContracts } from "@/lib/web3/keyed-multicall";
import { wagmiChainId } from "@/lib/web3/supported-chains";

/**
 * Live per-chain `isActiveVerifier` roster for the connected wallet.
 * Unread / pending → unresolved (fail closed).
 */
export function useKarProMembershipRoster(
  address: `0x${string}` | undefined,
  walletCommercialChainId: number | null,
): { rows: KarProMembershipRow[]; isPending: boolean } {
  const enabled = Boolean(address);
  const chainIds = commercialChainIds();

  const contracts = enabled
    ? chainIds.flatMap((chainId) => {
        const staking = karProStakingAddress(chainId);
        const wc = wagmiChainId(chainId);
        if (!staking || address == null) return [];
        return [
          {
            key: `isActiveVerifier-${chainId}` as const,
            address: staking,
            abi: KarProStakingAbi,
            functionName: "isActiveVerifier" as const,
            args: [address] as const,
            chainId: wc,
          },
        ];
      })
    : [];

  const reads = useKeyedReadContracts({
    contracts,
    query: { enabled },
  });

  const activeByChain = new Map<number, boolean | undefined>();
  for (const chainId of chainIds) {
    if (!enabled || reads.isPending) {
      activeByChain.set(chainId, undefined);
      continue;
    }
    const entry = reads.entry(`isActiveVerifier-${chainId}`);
    if (entry?.status === "success") {
      activeByChain.set(chainId, entry.result === true);
    } else {
      // Missing or failed read → unresolved (fail closed), not "not joined"
      activeByChain.set(chainId, undefined);
    }
  }

  const rows = deriveKarProMembershipRoster({
    commercialChainIds: chainIds,
    walletChainId: walletCommercialChainId,
    activeByChain,
  });

  return { rows, isPending: enabled && reads.isPending };
}
