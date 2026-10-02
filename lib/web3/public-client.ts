import { createPublicClient, http, type PublicClient } from "viem";

import type { Eip155ChainId } from "@/lib/web3/commercial-active";
import { getViemChain, rpcUrlForChain } from "@/lib/web3/supported-chains";

const cache = new Map<number, PublicClient>();

export function getPublicClient(chainId: Eip155ChainId): PublicClient {
  let c = cache.get(chainId);
  if (c) return c;
  const chain = getViemChain(chainId);
  c = createPublicClient({
    chain,
    transport: http(rpcUrlForChain(chainId)),
  });
  cache.set(chainId, c);
  return c;
}
