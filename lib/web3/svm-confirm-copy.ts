/**
 * Sole sentences for non-ok SVM confirm outcomes that are not program errors.
 */

import {
  commercialActive,
  type CommercialRegistry,
} from "@/lib/web3/commercial-active";
import { explorerTxUrl } from "@/lib/web3/network-explorer";

export function svmConfirmExpiredCopy(): string {
  return "The transaction expired before it landed. Nothing was written — you can submit again.";
}

export function svmConfirmStatusUnknownCopy(): string {
  return "The network did not confirm the transaction in time. It may still land — check the explorer before submitting again.";
}

/** Explorer URL for a status_unknown signature when the surface shows links. */
export function svmConfirmStatusUnknownExplorerUrl(
  namespace: number,
  signature: string,
  registry?: CommercialRegistry,
): string | null {
  const stack = commercialActive(namespace, registry);
  if (stack == null) return null;
  try {
    return explorerTxUrl(stack, signature);
  } catch {
    return null;
  }
}
