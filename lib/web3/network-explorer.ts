/**
 * Sole owner of commercial-network explorer URL construction (S8-1).
 * Base URL comes from the network class (`stack.explorerBaseUrl`) — never
 * invent a hub explorer or read viem `blockExplorers`.
 * Empty base is a type/registry invariant, not a runtime refusal.
 */

import type { CommercialActiveStack } from "@/lib/web3/commercial-active";
import { normalizeProtocolAddressForVm } from "@/lib/web3/protocol-address";

function explorerBase(stack: CommercialActiveStack): string {
  return stack.explorerBaseUrl.replace(/\/$/, "");
}

/**
 * Address page on the stack's explorer.
 * Normalizes via the stack VM.
 */
export function explorerAddressUrl(
  stack: CommercialActiveStack,
  address: string,
): string {
  const base = explorerBase(stack);
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
  const base = explorerBase(stack);
  const id = txId.trim();
  if (id.length === 0) {
    throw new Error("explorerTxUrl: empty transaction id");
  }
  return `${base}/tx/${id}`;
}
