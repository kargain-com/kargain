import { isCommercialChainId } from "@/lib/web3/commercial-active";

/**
 * KarPro hub target = connected wallet chain when commercial.
 * Non-commercial / missing → null (UI prompts switch; no hub fallback).
 */
export function resolveKarProTargetChainId(
  walletChainId: number | undefined,
): number | null {
  if (walletChainId == null || !Number.isFinite(walletChainId)) return null;
  if (!isCommercialChainId(walletChainId)) return null;
  return walletChainId;
}

/** Nav “Become KarPro” — show when connected and not active on the target chain. */
export function shouldShowBecomeKarPro(input: {
  isConnected: boolean;
  /** False when wallet is on a commercial chain and `isActiveVerifier` is true. */
  isActiveOnTarget: boolean;
}): boolean {
  return input.isConnected && !input.isActiveOnTarget;
}
