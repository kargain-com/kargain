import { resolveWalletCommercialChainId } from "@/lib/web3/chain-context";

/**
 * KarPro hub target = connected wallet chain when commercial.
 * Non-commercial / missing → null (UI prompts switch; no hub fallback).
 * Implementation: {@link resolveWalletCommercialChainId}.
 */
export function resolveKarProTargetChainId(
  walletChainId: number | undefined,
): number | null {
  return resolveWalletCommercialChainId(walletChainId);
}

/** Nav “Become KarPro” — show when connected and not active on the target chain. */
export function shouldShowBecomeKarPro(input: {
  isConnected: boolean;
  /** False when wallet is on a commercial chain and `isActiveVerifier` is true. */
  isActiveOnTarget: boolean;
}): boolean {
  return input.isConnected && !input.isActiveOnTarget;
}
