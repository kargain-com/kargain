import { createPublicClient, http, type PublicClient } from "viem";
import { sepolia } from "viem/chains";

import { rpcUrlForChain } from "@/lib/web3/supported-chains";

import { BRIDGE_SPOKE_CHAIN_ID } from "./bridge-config";

let cached: PublicClient | undefined;

/** Read-only viem client for Ethereum Sepolia spoke — never used for writes. */
export function getSpokeReadClient(): PublicClient {
  if (cached) return cached;
  cached = createPublicClient({
    chain: sepolia,
    transport: http(rpcUrlForChain(BRIDGE_SPOKE_CHAIN_ID)),
  });
  return cached;
}
