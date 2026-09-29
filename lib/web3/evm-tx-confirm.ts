/**
 * EVM transaction confirmation — sole product waitForTransactionReceipt door
 * (and confirmations wait for Irys deposits). Product callers go through
 * use-tx-sync / deposit ports; never call waitForTransactionReceipt directly.
 */

import type { Config } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import type { TransactionReceipt } from "viem";

import { getPublicClient } from "@/lib/web3/public-client";

export async function confirmEvmTransaction(
  config: Config,
  hash: `0x${string}`,
): Promise<TransactionReceipt> {
  return waitForTransactionReceipt(config, { hash });
}

const CONFIRMATIONS_POLL_MS = 1_000;
const CONFIRMATIONS_TIMEOUT_MS = 120_000;

/**
 * Receipt via {@link confirmEvmTransaction}, then wait until
 * `confirmations >= minConfirmations` on `chainId`.
 */
export async function confirmEvmTransactionConfirmations(
  config: Config,
  hash: `0x${string}`,
  minConfirmations: number,
  chainId: number,
): Promise<TransactionReceipt> {
  const receipt = await confirmEvmTransaction(config, hash);
  if (minConfirmations <= 1) {
    return receipt;
  }
  const client = getPublicClient(chainId);
  const deadline = Date.now() + CONFIRMATIONS_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const confirmations = await client.getTransactionConfirmations({ hash });
    if (confirmations >= BigInt(minConfirmations)) {
      return receipt;
    }
    await new Promise((r) => setTimeout(r, CONFIRMATIONS_POLL_MS));
  }
  throw new Error("evm_confirmations_timeout");
}
