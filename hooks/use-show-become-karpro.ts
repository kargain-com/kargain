"use client";

import {
  commercialNamespaceOf,
  useActiveAccount,
} from "@/hooks/use-active-account";

import { useActiveVerifierFact } from "@/hooks/use-active-verifier-fact";
import { shouldShowBecomeKarPro } from "@/lib/kar-pro/kar-pro-target-chain";

/**
 * Become KarPro CTA — connected on either VM, and active-verifier fact is not
 * known-true (pending / refused / inactive keep the entrance).
 * Session namespace from commercialNamespaceOf only — never invent chainId 0.
 */
export function useShowBecomeKarPro(): boolean {
  const { account } = useActiveAccount();
  const isConnected = account.status === "connected";
  const ns = commercialNamespaceOf(account);
  const targetChainId = ns.ok ? Number(ns.namespace) : undefined;
  const { fact } = useActiveVerifierFact({
    chainId: targetChainId,
  });
  const isActiveOnTarget =
    targetChainId != null && fact.kind === "active";

  return shouldShowBecomeKarPro({ isConnected, isActiveOnTarget });
}
