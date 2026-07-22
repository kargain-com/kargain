import { getViemChain, kargainChains } from "@/lib/web3/supported-chains";

/** True when `chainId` is in the wagmi write-union (`kargainChains`). */
export function isKargainWriteChain(chainId: number): boolean {
  return getViemChain(chainId) != null;
}

/**
 * Wrong-network for the nav chain selector.
 * - Unsupported wallet → wrong
 * - When `expectedChainId` is set (URL `?chain=`), wallet must match
 * - No expected → any write-union chain is OK (do not force hub default)
 */
export function deriveChainSelectorWrong(input: {
  isConnected: boolean;
  walletChainId: number;
  /** Present only when URL/page explicitly requires a chain — never DEFAULT fallback. */
  expectedChainId?: number | null;
}): boolean {
  if (!input.isConnected) return false;
  if (!isKargainWriteChain(input.walletChainId)) return true;
  if (input.expectedChainId == null) return false;
  return input.walletChainId !== input.expectedChainId;
}

/** Chains offered in the wrong-state switch menu (write-union order). */
export function chainSelectorSwitchTargets(
  expectedChainId?: number | null,
): readonly number[] {
  if (expectedChainId != null && isKargainWriteChain(expectedChainId)) {
    return [expectedChainId];
  }
  return kargainChains.map((c) => c.id);
}
