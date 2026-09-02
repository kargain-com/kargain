/**
 * Sole owner of commercial-network explorer URL construction (S8-1).
 * Base URL comes from the network class (`stack.explorerBaseUrl`) — never
 * invent a hub explorer or read viem `blockExplorers`.
 */

import {
  requireCommercialActive,
  type CommercialActiveStack,
} from "@/lib/web3/commercial-active";
import { normalizeProtocolAddressForVm } from "@/lib/web3/protocol-address";

/**
 * Address page on the stack's explorer.
 * Normalizes via the stack VM.
 */
export function explorerAddressUrl(
  stack: CommercialActiveStack,
  address: string,
): string {
  const base = stack.explorerBaseUrl;
  const normalized =
    normalizeProtocolAddressForVm(stack.vm, address) ?? address;
  return `${base}/address/${normalized}`;
}

/**
 * Transaction (or signature) page on the stack's explorer.
 * Refuses empty transaction id (parameter, not a stack field).
 */
export function explorerTxUrl(
  stack: CommercialActiveStack,
  txId: string,
): string {
  const base = stack.explorerBaseUrl;
  const id = txId.trim();
  if (id.length === 0) {
    throw new Error("explorerTxUrl: empty transaction id");
  }
  return `${base}/tx/${id}`;
}

/**
 * Address explorer URL for a commercial EIP-155 / registry key.
 * Pure producer for chrome that holds a chain id, not a stack.
 */
export function commercialExplorerAddressUrl(
  chainId: number,
  address: string,
): string {
  return explorerAddressUrl(requireCommercialActive(chainId), address);
}
