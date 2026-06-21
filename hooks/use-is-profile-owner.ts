"use client";

import { type Address } from "viem";
import { useAccount } from "wagmi";

export function useIsProfileOwner(wallet: Address): boolean {
  const { isConnected, address } = useAccount();
  return isConnected === true && address?.toLowerCase() === wallet.toLowerCase();
}
