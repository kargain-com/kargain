/**
 * Sole owner of commercial-network explorer URL construction (S8-1).
 * Base URL comes from the network class (`stack.explorerBaseUrl`) — never
 * invent a hub explorer or read viem `blockExplorers`.
 */

import type { CommercialActiveStack } from "@/lib/web3/commercial-active";
import { normalizeProtocolAddressForVm } from "@/lib/web3/protocol-address";

function requireExplorerBase(stack: CommercialActiveStack): string {
  const base = stack.explorerBaseUrl?.trim() ?? "";
  if (base.length === 0) {
    throw new Error(
      `explorerBaseUrl: commercial stack namespace ${stack.namespace} has no explorer`,
    );
  }
  return base.replace(/\/$/, "");
}

/**
 * Address page on the stack's explorer.
 * Normalizes via the stack VM; refuses when the stack has no explorer base.
 */
export function explorerAddressUrl(
  stack: CommercialActiveStack,
  address: string,
): string {
  const base = requireExplorerBase(stack);
  const normalized =
    normalizeProtocolAddressForVm(stack.vm, address) ?? address;
  return `${base}/address/${normalized}`;
}

/**
 * Transaction (or signature) page on the stack's explorer.
 * Refuses when the stack has no explorer base.
 */
export function explorerTxUrl(
  stack: CommercialActiveStack,
  txId: string,
): string {
  const base = requireExplorerBase(stack);
  const id = txId.trim();
  if (id.length === 0) {
    throw new Error("explorerTxUrl: empty transaction id");
  }
  return `${base}/tx/${id}`;
}
