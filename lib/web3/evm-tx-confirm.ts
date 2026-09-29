/**
 * EVM transaction confirmation — sole product waitForTransactionReceipt door
 * (and confirmations wait for Irys deposits). Product callers go through
 * use-tx-sync / deposit ports; never call waitForTransactionReceipt directly.
 *
 * `confirmEvmTransaction` is the runTx receipt door (unchanged shape).
 * `confirmEvmTransactionConfirmations` is deposit-only: follows replacements
 * via onReplaced and returns a typed outcome (never treats cancel receipt as paid).
 */

import type { Config } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import type { Hash, TransactionReceipt } from "viem";

import { getPublicClient } from "@/lib/web3/public-client";

export async function confirmEvmTransaction(
  config: Config,
  hash: `0x${string}`,
): Promise<TransactionReceipt> {
  return waitForTransactionReceipt(config, { hash });
}

const CONFIRMATIONS_POLL_MS = 1_000;
const CONFIRMATIONS_TIMEOUT_MS = 120_000;

export type EvmDepositConfirmOutcome =
  | { kind: "confirmed"; hash: `0x${string}` }
  | { kind: "cancelled"; originalHash: `0x${string}` }
  | { kind: "timeout" };

/**
 * Deposit-only confirmations wait.
 * Passes `onReplaced`: replaced/repriced → follow final hash; cancelled decided
 * only by `reason === "cancelled"` (receipt presence never means paid).
 */
export async function confirmEvmTransactionConfirmations(
  config: Config,
  hash: `0x${string}`,
  minConfirmations: number,
  chainId: number,
): Promise<EvmDepositConfirmOutcome> {
  let finalHash: Hash = hash;
  let cancelled = false;

  try {
    await waitForTransactionReceipt(config, {
      hash,
      onReplaced: (replacement) => {
        if (replacement.reason === "cancelled") {
          cancelled = true;
          return;
        }
        finalHash = replacement.transaction.hash;
      },
    });
  } catch {
    return { kind: "timeout" };
  }

  if (cancelled) {
    return { kind: "cancelled", originalHash: hash };
  }

  if (minConfirmations <= 1) {
    return { kind: "confirmed", hash: finalHash };
  }

  const client = getPublicClient(chainId);
  const deadline = Date.now() + CONFIRMATIONS_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const confirmations = await client.getTransactionConfirmations({
      hash: finalHash,
    });
    if (confirmations >= BigInt(minConfirmations)) {
      return { kind: "confirmed", hash: finalHash };
    }
    await new Promise((r) => setTimeout(r, CONFIRMATIONS_POLL_MS));
  }
  return { kind: "timeout" };
}
