import { createPublicClient, http, type PublicClient } from "viem";

import { getViemChain, rpcUrlForChain } from "@/lib/web3/supported-chains";

const cache = new Map<number, PublicClient>();

/** Read-only viem client for a bridge chain — never used for writes. */
export function getBridgeReadClient(chainId: number): PublicClient {
  let client = cache.get(chainId);
  if (client) return client;
  const chain = getViemChain(chainId);
  if (!chain) throw new Error(`Unsupported chain: ${chainId}`);
  client = createPublicClient({
    chain,
    transport: http(rpcUrlForChain(chainId)),
  });
  cache.set(chainId, client);
  return client;
}
