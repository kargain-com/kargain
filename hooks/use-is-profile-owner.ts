"use client";

import {
  useActiveAccount,
  commercialNamespaceOf,
  requireEvmSession,
} from "@/hooks/use-active-account";
import { protocolAddressesEqual } from "@/lib/web3/protocol-address";

/**
 * True when the active session address is the profile subject.
 * Compares via protocol-address at the session commercial namespace.
 * Calls {@link requireEvmSession} so this remains a known session gate; ownership
 * itself keys off {@link commercialNamespaceOf} (SVM and EVM).
 */
export function useIsProfileOwner(wallet: string): boolean {
  const { account } = useActiveAccount();
  void requireEvmSession(account);
  const ns = commercialNamespaceOf(account);
  if (!ns.ok || account.status !== "connected") return false;
  return protocolAddressesEqual(Number(ns.namespace), account.address, wallet);
}
