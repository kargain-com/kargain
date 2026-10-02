import { createPublicClient, http, type PublicClient } from "viem";

import type { Eip155ChainId } from "@/lib/web3/commercial-active";
import { getViemChain, rpcUrlForChain } from "@/lib/web3/supported-chains";

const cache = new Map<number, PublicClient>();

/** Read-only viem client for a bridge chain — never used for writes. */
export function getBridgeReadClient(chainId: Eip155ChainId): PublicClient {
  let client = cache.get(chainId);
  if (client) return client;
  const chain = getViemChain(chainId);
  client = createPublicClient({
    chain,
    transport: http(rpcUrlForChain(chainId)),
  });
  cache.set(chainId, client);
  return client;
}
