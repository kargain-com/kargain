import { useConfig } from "wagmi";
import type { Config } from "wagmi";
import type { TransactionReceipt } from "viem";

import {
  type ActiveAccount,
  wrongVmActionCopy,
} from "@/lib/web3/active-account";
import type {
  CommercialRegistry,
  SvmCommercialActiveStack,
} from "@/lib/web3/commercial-active";
import {
  awaitEvmWriteReceipt,
  runEvmWriteLifecycle,
  type EvmWriteLifecyclePhase,
} from "@/lib/web3/evm-write-lifecycle";
import {
  runSvmWriteLifecycle,
  type FetchSvmStructuredPayloads,
} from "@/lib/web3/svm-write-lifecycle";
import { type IndexerBlockNumberResult } from "@/lib/web3/tx-sync";
import {
  txWriteAvailability,
  txWriteRefusalMessage,
} from "@/lib/web3/tx-write-availability";
import type { WriteOutcome } from "@/lib/web3/write-outcome";
import type { SvmTxConfirmPort } from "@/lib/web3/svm-tx-confirm";

export type WriteLifecyclePhase = "wallet" | "confirming" | "indexing";

export type WriteLifecycleConfig = {
  wagmiConfig: Config;
};

type AwaitWriteReceiptOptions = {
  account: ActiveAccount;
  chainId: number;
  config: WriteLifecycleConfig;
  hash: `0x${string}`;
  onPhase?: (phase: WriteLifecyclePhase) => void;
  registry?: CommercialRegistry;
  confirmTransaction?: (
    config: Config,
    hash: `0x${string}`,
  ) => Promise<TransactionReceipt>;
};

type RunWriteLifecycleOptions = {
  account: ActiveAccount;
  chainId: number;
  config: WriteLifecycleConfig;
  switchChain: (chainId: number) => Promise<void>;
  writeFn: () => Promise<string>;
  fetchIndexerStatus: () => Promise<IndexerBlockNumberResult>;
  wait: (ms: number) => Promise<void>;
  onPhase?: (phase: WriteLifecyclePhase) => void;
  registry?: CommercialRegistry;
  confirmTransaction?: (
    config: Config,
    hash: `0x${string}`,
  ) => Promise<TransactionReceipt>;
  resolveTargetChainId?: (chainId: number) => number;
  createConfirmPort?: (stack: SvmCommercialActiveStack) => SvmTxConfirmPort;
  fetchStructuredPayloads?: FetchSvmStructuredPayloads;
};

function svmAwaitReceiptRefusal(): Error {
  return new Error(wrongVmActionCopy("evm"));
}

export async function awaitWriteReceipt({
  account,
  chainId,
  config,
  hash,
  onPhase,
  registry,
  confirmTransaction,
}: AwaitWriteReceiptOptions) {
  const avail = txWriteAvailability(account, chainId, registry);
  if (!avail.available) {
    throw new Error(txWriteRefusalMessage(avail.cause));
  }
  if (avail.vm !== "evm") {
    throw svmAwaitReceiptRefusal();
  }
  return await awaitEvmWriteReceipt({
    account,
    chainId,
    config: config.wagmiConfig,
    hash,
    onPhase: onPhase as ((phase: EvmWriteLifecyclePhase) => void) | undefined,
    confirmTransaction,
  });
}

export async function runWriteLifecycle({
  account,
  chainId,
  config,
  switchChain,
  writeFn,
  fetchIndexerStatus,
  wait,
  onPhase,
  registry,
  confirmTransaction,
  resolveTargetChainId,
  createConfirmPort,
  fetchStructuredPayloads,
}: RunWriteLifecycleOptions): Promise<WriteOutcome> {
  const avail = txWriteAvailability(account, chainId, registry);
  if (!avail.available) {
    throw new Error(txWriteRefusalMessage(avail.cause));
  }
  if (avail.vm === "evm") {
    return runEvmWriteLifecycle({
      account,
      chainId,
      config: config.wagmiConfig,
      switchChain,
      writeFn,
      fetchIndexerStatus,
      wait,
      onPhase: onPhase as ((phase: EvmWriteLifecyclePhase) => void) | undefined,
      confirmTransaction,
      resolveTargetChainId,
    });
  }
  return runSvmWriteLifecycle({
    chainId,
    writeFn,
    onPhase,
    registry,
    createConfirmPort,
    fetchStructuredPayloads,
  });
}

export function useWriteLifecycleConfig(): WriteLifecycleConfig {
  return {
    wagmiConfig: useConfig(),
  };
}
