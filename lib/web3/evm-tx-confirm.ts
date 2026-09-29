/**
 * EVM transaction confirmation — sole product waitForTransactionReceipt door
 * (and confirmations wait for Irys deposits). Product callers go through
 * use-tx-sync / deposit ports; never call waitForTransactionReceipt directly.
 *
 * Waits via viem on `config.getClient()` — not wagmi's action, which throws on
 * `status === "reverted"` and erases the receipt. Timeout is always explicit:
 * wagmi's default `timeout = 0` disables viem's timer.
 *
 * `confirmEvmTransaction` is the runTx Outcome door.
 * `confirmEvmTransactionConfirmations` is deposit-only: follows only bundler-bound
 * replacements via onReplaced; uses viem `confirmations` (no hand poll).
 */

import type { Config } from "wagmi";
import {
  isAddressEqual,
  WaitForTransactionReceiptTimeoutError,
  type Hash,
  type TransactionReceipt,
} from "viem";
import { waitForTransactionReceipt } from "viem/actions";

/**
 * Explicit wait ceiling — viem's own default when `timeout` is omitted.
 * wagmi's `waitForTransactionReceipt` defaults `timeout = 0`, which never arms
 * viem's timer; product waits must pass this constant.
 */
export const EVM_TX_CONFIRM_TIMEOUT_MS = 180_000;

export type EvmConfirmOutcome =
  | { kind: "landed_ok"; receipt: TransactionReceipt }
  | { kind: "reverted"; hash: `0x${string}`; blockNumber: bigint }
  | {
      kind: "superseded";
      originalHash: `0x${string}`;
      replacementHash: `0x${string}`;
      reason: "cancelled" | "replaced";
    }
  | { kind: "status_unknown"; hash: `0x${string}` };

export type EvmConfirmRefusalOutcome = Exclude<
  EvmConfirmOutcome,
  { kind: "landed_ok" }
>;

/**
 * Typed carrier so lifecycle / runTx can surface a confirm Outcome without
 * encoding sentences into `Error.message`.
 */
export class EvmConfirmRefusal extends Error {
  readonly outcome: EvmConfirmRefusalOutcome;

  constructor(outcome: EvmConfirmRefusalOutcome) {
    super(
      outcome.kind === "reverted"
        ? "evm confirm: transaction reverted"
        : outcome.kind === "superseded"
          ? "evm confirm: transaction superseded"
          : "evm confirm: status unknown",
    );
    this.name = "EvmConfirmRefusal";
    this.outcome = outcome;
  }
}

export function isEvmConfirmRefusal(err: unknown): err is EvmConfirmRefusal {
  return err instanceof EvmConfirmRefusal;
}

export async function confirmEvmTransaction(
  config: Config,
  hash: `0x${string}`,
): Promise<EvmConfirmOutcome> {
  const client = config.getClient();
  const replacedState: {
    superseded: {
      replacementHash: `0x${string}`;
      reason: "cancelled" | "replaced";
    } | null;
  } = { superseded: null };

  let receipt: TransactionReceipt;
  try {
    receipt = await waitForTransactionReceipt(client, {
      hash,
      timeout: EVM_TX_CONFIRM_TIMEOUT_MS,
      onReplaced: (replacement) => {
        if (replacement.reason === "repriced") {
          return;
        }
        replacedState.superseded = {
          replacementHash: replacement.transaction.hash,
          reason: replacement.reason,
        };
      },
    });
  } catch (err) {
    if (err instanceof WaitForTransactionReceiptTimeoutError) {
      return { kind: "status_unknown", hash };
    }
    throw err;
  }

  if (replacedState.superseded != null) {
    return {
      kind: "superseded",
      originalHash: hash,
      replacementHash: replacedState.superseded.replacementHash,
      reason: replacedState.superseded.reason,
    };
  }

  if (receipt.status === "reverted") {
    return {
      kind: "reverted",
      hash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
    };
  }

  return { kind: "landed_ok", receipt };
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
 * Only `WaitForTransactionReceiptTimeoutError` maps to `timeout`; other errors propagate.
 */
export async function confirmEvmTransactionConfirmations(
  config: Config,
  hash: `0x${string}`,
  minConfirmations: number,
  expectedTo: `0x${string}`,
): Promise<EvmDepositConfirmOutcome> {
  const client = config.getClient();
  let finalHash: Hash = hash;
  let cancelled = false;
  let divertedReplacement: Hash | null = null;

  try {
    await waitForTransactionReceipt(client, {
      hash,
      confirmations: minConfirmations,
      timeout: EVM_TX_CONFIRM_TIMEOUT_MS,
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
  } catch (err) {
    if (err instanceof WaitForTransactionReceiptTimeoutError) {
      return { kind: "timeout" };
    }
    throw err;
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
