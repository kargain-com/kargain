/**
 * EVM transaction confirmation — sole product waitForTransactionReceipt door
 * besides the use-tx-sync owner (which is the only caller).
 */

import type { Config } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import type { TransactionReceipt } from "viem";

export async function confirmEvmTransaction(
  config: Config,
  hash: `0x${string}`,
): Promise<TransactionReceipt> {
  return waitForTransactionReceipt(config, { hash });
}
