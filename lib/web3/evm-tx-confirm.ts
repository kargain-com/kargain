/**
 * EVM transaction confirmation — sole product waitForTransactionReceipt door
 * (and confirmations wait for Irys deposits). Product callers go through
 * use-tx-sync / deposit ports; never call waitForTransactionReceipt directly.
 *
 * `confirmEvmTransaction` is the runTx receipt door (unchanged shape).
 * `confirmEvmTransactionConfirmations` is deposit-only: follows only bundler-bound
 * replacements via onReplaced; uses viem `confirmations` (no hand poll).
 */

import type { Config } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { isAddressEqual, type Hash, type TransactionReceipt } from "viem";

export async function confirmEvmTransaction(
  config: Config,
  hash: `0x${string}`,
): Promise<TransactionReceipt> {
  return waitForTransactionReceipt(config, { hash });
}

export type EvmDepositConfirmOutcome =
  | { kind: "confirmed"; hash: `0x${string}` }
  | { kind: "cancelled"; originalHash: `0x${string}` }
  | {
      kind: "diverted";
      originalHash: `0x${string}`;
      replacementHash: `0x${string}`;
    }
  | { kind: "timeout" };

/**
 * Deposit-only confirmations wait.
 * - `repriced` → follow replacement hash.
 * - `cancelled` → cancelled (reason only; receipt never means paid).
 * - `replaced` to `expectedTo` → follow (still a bundler transfer).
 * - `replaced` elsewhere → diverted.
 * Depth via viem `confirmations` — no separate poll loop.
 */
export async function confirmEvmTransactionConfirmations(
  config: Config,
  hash: `0x${string}`,
  minConfirmations: number,
  expectedTo: `0x${string}`,
): Promise<EvmDepositConfirmOutcome> {
  let finalHash: Hash = hash;
  let cancelled = false;
  let divertedReplacement: Hash | null = null;

  try {
    await waitForTransactionReceipt(config, {
      hash,
      confirmations: minConfirmations,
      onReplaced: (replacement) => {
        if (replacement.reason === "cancelled") {
          cancelled = true;
          return;
        }
        if (replacement.reason === "repriced") {
          finalHash = replacement.transaction.hash;
          return;
        }
        // replaced — follow only if still to the bundler
        const to = replacement.transaction.to;
        if (to != null && isAddressEqual(to, expectedTo)) {
          finalHash = replacement.transaction.hash;
          return;
        }
        divertedReplacement = replacement.transaction.hash;
      },
    });
  } catch {
    return { kind: "timeout" };
  }

  if (cancelled) {
    return { kind: "cancelled", originalHash: hash };
  }
  if (divertedReplacement != null) {
    return {
      kind: "diverted",
      originalHash: hash,
      replacementHash: divertedReplacement,
    };
  }
  return { kind: "confirmed", hash: finalHash };
}
