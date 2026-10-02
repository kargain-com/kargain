/**
 * ActiveAccount switchChain signature — sole type for the provider entry (N1).
 * Takes branded {@link Eip155ChainId} only so a bare namespace `number` cannot
 * invent success. Call sites resolve via {@link resolveEvmChain} first;
 * KargainWriteUnionChainId collapses to `number` under viem Chain.id and cannot
 * carry this invent-ban without breaking wagmi config generics.
 */

import type { Eip155ChainId } from "@/lib/web3/commercial-active";

export type ActiveAccountSwitchChain = (
  chainId: Eip155ChainId,
) => Promise<void>;
