import type { Chain, PublicClient } from "viem";

import { getViemChain, rpcUrlForChain } from "@/lib/web3/supported-chains";
import { VINCENT_REGISTRY } from "@/lib/vincent-commons/registry-config";
import type { PublisherEpochsInput } from "@/lib/vincent-commons/registry-panel";

/**
 * Batched viem client for registry reads. Separate from the shared
 * `lib/web3/public-client.ts` cache so concurrent per-publisher
 * `epochCount` / `getEpoch` calls collapse into multicall batches.
 */
let registryClient: { publicClient: PublicClient; chain: Chain } | null = null;

async function getRegistryClient(): Promise<{
  publicClient: PublicClient;
  chain: Chain;
}> {
  if (registryClient) return registryClient;
  const { createPublicClient, http } = await import("viem");
  const chain = getViemChain(VINCENT_REGISTRY.chainId);
  if (!chain) {
    throw new Error(`Unsupported chain: ${VINCENT_REGISTRY.chainId}`);
  }
  registryClient = {
    publicClient: createPublicClient({
      chain,
      transport: http(rpcUrlForChain(VINCENT_REGISTRY.chainId)),
      batch: { multicall: true },
    }),
    chain,
  };
  return registryClient;
}

/**
 * Read per-publisher epoch chains from VincentAnchorRegistry for the given
 * verifier addresses. `@kargain/vincent/anchor` loads via dynamic import —
 * never in the `/kar-pro` bundle. Throws on RPC failure (callers map that to
 * the fail-silent "Registry unreachable" state).
 */
export async function fetchRegistryPublishers(
  addresses: `0x${string}`[],
): Promise<PublisherEpochsInput[]> {
  if (addresses.length === 0) return [];

  const [{ createAnchorReader }, { publicClient, chain }] = await Promise.all([
    import("@kargain/vincent/anchor"),
    getRegistryClient(),
  ]);

  const reader = createAnchorReader({
    registryAddress: VINCENT_REGISTRY.registryAddress,
    chain,
    publicClient,
  });

  const counts = await Promise.all(
    addresses.map((address) => reader.getEpochCount(address)),
  );

  return Promise.all(
    addresses.map(async (address, i): Promise<PublisherEpochsInput> => {
      const epochCount = counts[i];
      if (epochCount === 0) {
        return { address, epochCount, epochs: [] };
      }
      const epochs = await Promise.all(
        Array.from({ length: epochCount }, (_, index) =>
          reader.getEpoch(address, index),
        ),
      );
      return { address, epochCount, epochs };
    }),
  );
}
