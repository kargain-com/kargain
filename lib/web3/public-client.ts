import { createPublicClient, http, type PublicClient } from "viem";

import { getViemChain, rpcUrlForChain } from "@/lib/web3/supported-chains";

const cache = new Map<number, PublicClient>();

export function getPublicClient(chainId: number): PublicClient {
  let c = cache.get(chainId);
  if (c) return c;
  const chain = getViemChain(chainId);
  if (!chain) throw new Error(`Unsupported chain: ${chainId}`);
  c = createPublicClient({
    chain,
    transport: http(rpcUrlForChain(chainId)),
  });
  cache.set(chainId, c);
  return c;
}
