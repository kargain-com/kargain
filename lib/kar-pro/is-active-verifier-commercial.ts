import { KarProStakingAbi } from "@/lib/contracts/abis.generated";
import { karProStakingAddress } from "@/lib/web3/deployment-addresses";
import { getPublicClient } from "@/lib/web3/public-client";

/**
 * Per-chain batch of `isActiveVerifier`. Return `null` when the chain read
 * failed entirely (RPC / multicall throw). A resolved array is usable even if
 * every entry is false.
 */
export type ReadChainVerifierActive = (
  chainId: number,
  addresses: readonly `0x${string}`[],
) => Promise<boolean[] | null>;

export type VerifierMembershipRef = {
  chainId: number;
  address: `0x${string}`;
};

export type ActiveMembershipsBatchResult =
  | { status: "success"; activeByMembership: Map<string, boolean> }
  | { status: "failure" };

/** Ponder-aligned membership key: `${chainId}-${address.toLowerCase()}`. */
export function verifierMembershipKey(chainId: number, address: string): string {
  return `${chainId}-${address.toLowerCase()}`;
}

async function readChainActiveMulticall(
  chainId: number,
  addresses: readonly `0x${string}`[],
): Promise<boolean[] | null> {
  const staking = karProStakingAddress(chainId);
  if (!staking) {
    return addresses.map(() => false);
  }
  try {
    const client = getPublicClient(chainId);
    const results = await client.multicall({
      allowFailure: true,
      contracts: addresses.map((wallet) => ({
        address: staking,
        abi: KarProStakingAbi,
        functionName: "isActiveVerifier" as const,
        args: [wallet] as const,
      })),
    });
    return results.map((r) => r.status === "success" && r.result === true);
  } catch {
    return null;
  }
}

/**
 * Per-membership `isActiveVerifier` (no OR across chains).
 * Groups by chainId and multicalls only addresses present on that chain.
 * Empty input → success with empty map. Failure only when every chain read fails.
 */
export async function readActiveVerifierMemberships(
  memberships: readonly VerifierMembershipRef[],
  deps?: { readChainActive?: ReadChainVerifierActive },
): Promise<ActiveMembershipsBatchResult> {
  if (memberships.length === 0) {
    return { status: "success", activeByMembership: new Map() };
  }

  const read = deps?.readChainActive ?? readChainActiveMulticall;
  const byChain = new Map<number, `0x${string}`[]>();
  for (const m of memberships) {
    if (!Number.isFinite(m.chainId) || m.chainId <= 0) continue;
    const list = byChain.get(m.chainId) ?? [];
    const lower = m.address.toLowerCase();
    if (!list.some((a) => a.toLowerCase() === lower)) {
      list.push(m.address);
    }
    byChain.set(m.chainId, list);
  }

  if (byChain.size === 0) {
    return { status: "success", activeByMembership: new Map() };
  }

  const chainEntries = [...byChain.entries()];
  const perChain = await Promise.all(
    chainEntries.map(async ([chainId, addresses]) => {
      try {
        const row = await read(chainId, addresses);
        return { chainId, addresses, row };
      } catch {
        return { chainId, addresses, row: null as boolean[] | null };
      }
    }),
  );

  const usable = perChain.filter((entry) => entry.row != null);
  if (usable.length === 0) {
    return { status: "failure" };
  }

  const activeByMembership = new Map<string, boolean>();
  for (const { chainId, addresses, row } of usable) {
    for (let i = 0; i < addresses.length; i++) {
      activeByMembership.set(
        verifierMembershipKey(chainId, addresses[i]!),
        row![i] === true,
      );
    }
  }
  return { status: "success", activeByMembership };
}
