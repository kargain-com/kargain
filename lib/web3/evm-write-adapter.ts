"use client";

/**
 * Sole product caller of wagmi write/send hooks (S8-3).
 * Panels consume these adapters; they never import useWriteContract /
 * useSendTransaction from wagmi directly.
 */

import {
  useSendTransaction,
  useWriteContract,
} from "wagmi";

/** EVM contract write — sole product wrapper for wagmi `useWriteContract`. */
export function useEvmWriteContract() {
  return useWriteContract();
}

/** Native ETH send — sole product wrapper for wagmi `useSendTransaction`. */
export function useEvmSendTransaction() {
  return useSendTransaction();
}
