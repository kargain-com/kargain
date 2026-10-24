import { KarProStakingAbi } from "@/lib/contracts/abis.generated";
import { karProStakingAddress } from "@/lib/web3/deployment-addresses";
import { resolveEvmChain } from "@/lib/web3/commercial-active";
import { getPublicClient } from "@/lib/web3/public-client";

/**
 * Per-chain batch of `isActiveVerifier`. Return `null` when the chain read
 * failed entirely (RPC / multicall throw) or when the namespace is not an EVM
 * commercial network (no `isActiveVerifier` read exists there).
 * Per-slot unread (failed multicall entry) is `null` in the array — never invent
 * inactive from a failed read. A resolved array may mix true / false / null.
 */
export type ReadChainVerifierActive = (
  chainId: number,
  addresses: readonly `0x${string}`[],
) => Promise<(boolean | null)[] | null>;

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
): Promise<(boolean | null)[] | null> {
  const resolved = resolveEvmChain(chainId);
  if (!resolved.ok) return null;
  const staking = karProStakingAddress(resolved.chainId);
  try {
    const client = getPublicClient(resolved.chainId);
    const results = await client.multicall({
      allowFailure: true,
      contracts: addresses.map((wallet) => ({
        address: staking,
        abi: KarProStakingAbi,
        functionName: "isActiveVerifier" as const,
        args: [wallet] as const,
      })),
    });
    return results.map((r) => {
      if (r.status !== "success") return null;
      return r.result === true;
    });
  } catch {
    return null;
  }
}

/**
 * Per-membership `isActiveVerifier` (no OR across chains).
 * Groups by chainId and multicalls only addresses present on that chain.
 * Empty input → success with empty map. Failure only when every chain read fails.
 * Known true/false are written; per-slot unread and failed chains omit the key
 * (callers treat missing as unresolved — never invent inactive).
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
        return {
          chainId,
          addresses,
          row: null as (boolean | null)[] | null,
        };
      }
    }),
  );

  const usable = perChain.filter((entry) => entry.row != null);
  if (usable.length === 0) {
    return { status: "failure" };
  }

  const activeByMembership = new Map<string, boolean>();
  for (const { chainId, addresses, row } of usable) {
    const slots = row;
    if (slots == null) continue;
    for (let i = 0; i < addresses.length; i++) {
      const slot = slots[i];
      if (slot == null) continue;
      const address = addresses[i];
      if (address == null) continue;
      activeByMembership.set(verifierMembershipKey(chainId, address), slot);
    }
  }
  return { status: "success", activeByMembership };
}
