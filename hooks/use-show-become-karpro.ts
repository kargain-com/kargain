"use client";

import {
  commercialNamespaceOf,
  requireEvmSession,
  useActiveAccount,
} from "@/hooks/use-active-account";

import { useActiveVerifierFact } from "@/hooks/use-active-verifier-fact";
import {
  resolveKarProTargetChainId,
  shouldShowBecomeKarPro,
} from "@/lib/kar-pro/kar-pro-target-chain";

/**
 * Become KarPro CTA — connected on either VM, and active-verifier fact is not
 * known-true (pending / refused / inactive keep the entrance).
 */
export function useShowBecomeKarPro(): boolean {
  const { account } = useActiveAccount();
  const isConnected = account.status === "connected";
  const ns = commercialNamespaceOf(account);
  const evm = requireEvmSession(account);
  const walletChainId = evm.ok ? evm.chainId : undefined;
  const targetChainId = ns.ok
    ? Number(ns.namespace)
    : resolveKarProTargetChainId(walletChainId);
  /** Unresolved target → 0 (no commercial stack); never invent hub 84532. */
  const { fact } = useActiveVerifierFact({
    chainId: targetChainId ?? 0,
  });
  const isActiveOnTarget =
    targetChainId != null && fact.kind === "active";

  return shouldShowBecomeKarPro({ isConnected, isActiveOnTarget });
}
