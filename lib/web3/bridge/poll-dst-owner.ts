/**
 * Destination delivery poll for ONFT receive — refuses non-EVM / unresolved
 * namespaces by name before opening an RPC client (N1).
 */

import { getAddress, type Address } from "viem";

import { KarPassportAbi } from "@/lib/contracts/abis.generated";
import { resolveEvmChain } from "@/lib/web3/commercial-active";
import {
  BRIDGE_DELIVERY_POLL_MS,
  BRIDGE_DELIVERY_TIMEOUT_MS,
  bridgeTokenAddress,
} from "@/lib/web3/bridge/bridge-config";
import { getBridgeReadClient } from "@/lib/web3/bridge/bridge-read-client";

export type PollDstOwnerResult =
  | { status: "delivered" }
  | { status: "timeout" }
  | { status: "aborted" }
  | { status: "refused"; cause: "not_evm" | "unresolved_namespace" };

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function pollDstOwner(
  tokenId: bigint,
  recipient: Address,
  dstChainId: number,
  signal: AbortSignal,
): Promise<PollDstOwnerResult> {
  const resolved = resolveEvmChain(dstChainId);
  if (!resolved.ok) {
    return { status: "refused", cause: resolved.cause };
  }
  const client = getBridgeReadClient(resolved.chainId);
  const token = bridgeTokenAddress(dstChainId);
  if (!token) {
    return { status: "refused", cause: "unresolved_namespace" };
  }
  const deadline = Date.now() + BRIDGE_DELIVERY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (signal.aborted) return { status: "aborted" };
    try {
      const owner = getAddress(
        (await client.readContract({
          address: token,
          abi: KarPassportAbi,
          functionName: "ownerOf",
          args: [tokenId],
        })) as Address,
      );
      if (owner === recipient) return { status: "delivered" };
    } catch {
      // Token not yet minted on destination / transient RPC
    }
    await wait(BRIDGE_DELIVERY_POLL_MS);
  }
  return { status: "timeout" };
}
