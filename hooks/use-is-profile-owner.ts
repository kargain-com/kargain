"use client";

import { useActiveAccount, requireEvmSession } from "@/hooks/use-active-account";

import { type Address } from "viem";

export function useIsProfileOwner(wallet: Address): boolean {
  const { account } = useActiveAccount();
  const evm = requireEvmSession(account);
  const address = evm.ok ? evm.address : undefined;
  const isConnected = evm.ok;
  return isConnected === true && address?.toLowerCase() === wallet.toLowerCase();
}
