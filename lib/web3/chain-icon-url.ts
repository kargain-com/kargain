/**
 * Network icon URLs from the commercial network class (S8-1).
 * Keyed by namespace — never invent a hub icon for an unknown network.
 */

import type { CommercialActiveStack } from "@/lib/web3/commercial-active";

const TRUST =
  "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains";

/** Product icon map — live EVM namespaces only until S9. */
const BY_NAMESPACE: Readonly<Record<string, string>> = {
  "84532": `${TRUST}/base/info/logo.png`,
  // Eth Sepolia has no Trust Wallet chain asset — refuse (caller shows globe).
};

/**
 * Icon URL for a commercial stack, or `undefined` when the network class has none.
 * Does not fall back to another network's icon.
 */
export function networkIconUrl(stack: CommercialActiveStack): string | undefined {
  return BY_NAMESPACE[String(stack.namespace)];
}
