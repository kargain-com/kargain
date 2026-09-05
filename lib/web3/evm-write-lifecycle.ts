"use client";

import { useConfig } from "wagmi";
import type { Config } from "wagmi";
import type { TransactionReceipt } from "viem";

import {
  evmSwitchChainAvailability,
  type ActiveAccount,
} from "@/lib/web3/active-account";
import { confirmEvmTransaction } from "@/lib/web3/evm-tx-confirm";
import { wagmiChainId } from "@/lib/web3/supported-chains";
import {
  waitForIndexerBlock,
  type IndexerBlockNumberResult,
} from "@/lib/web3/tx-sync";
import {
  txWriteAvailability,
  txWriteRefusalMessage,
} from "@/lib/web3/tx-write-availability";

export type EvmWriteLifecyclePhase = "wallet" | "confirming" | "indexing";

export type EvmWriteLifecycleSuccess = {
  receipt: TransactionReceipt;
  synced: boolean;
};

type EvmReceiptAwaitOptions = {
  account: ActiveAccount;
  chainId: number;
  config: Config;
  hash: `0x${string}`;
  onPhase?: (phase: EvmWriteLifecyclePhase) => void;
  confirmTransaction?: (
    config: Config,
    hash: `0x${string}`,
  ) => Promise<TransactionReceipt>;
};

type RunEvmWriteLifecycleOptions = {
  account: ActiveAccount;
  chainId: number;
  config: Config;
  switchChain: (chainId: number) => Promise<void>;
  writeFn: () => Promise<string>;
  fetchIndexerStatus: () => Promise<IndexerBlockNumberResult>;
  wait: (ms: number) => Promise<void>;
  onPhase?: (phase: EvmWriteLifecyclePhase) => void;
  confirmTransaction?: (
    config: Config,
    hash: `0x${string}`,
  ) => Promise<TransactionReceipt>;
  resolveTargetChainId?: (chainId: number) => number;
};

function assertEvmTxHash(value: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("Transaction hash is not a valid EVM hash.");
  }
  return value as `0x${string}`;
}

export async function awaitEvmWriteReceipt({
  account,
  chainId,
  config,
  hash,
  onPhase,
  confirmTransaction = confirmEvmTransaction,
}: EvmReceiptAwaitOptions): Promise<TransactionReceipt> {
  const avail = txWriteAvailability(account, chainId);
  if (!avail.available) {
    throw new Error(txWriteRefusalMessage(avail.cause));
  }
  onPhase?.("confirming");
  return confirmTransaction(config, hash);
}

export async function runEvmWriteLifecycle({
  account,
  chainId,
  config,
  switchChain,
  writeFn,
  fetchIndexerStatus,
  wait,
  onPhase,
  confirmTransaction = confirmEvmTransaction,
  resolveTargetChainId = wagmiChainId,
}: RunEvmWriteLifecycleOptions): Promise<EvmWriteLifecycleSuccess> {
  const avail = txWriteAvailability(account, chainId);
  if (!avail.available) {
    throw new Error(txWriteRefusalMessage(avail.cause));
  }

  onPhase?.("wallet");
  const targetChainId = resolveTargetChainId(chainId);
  if (avail.walletChainId !== targetChainId) {
    const switchAvail = evmSwitchChainAvailability(account);
    if (!switchAvail.available) {
      throw new Error(`switchChain unavailable: ${switchAvail.cause}`);
    }
    await switchChain(chainId);
  }

  const txHash = assertEvmTxHash(await writeFn());

  onPhase?.("confirming");
  const receipt = await confirmTransaction(config, txHash);

  onPhase?.("indexing");
  const { synced } = await waitForIndexerBlock({
    targetBlock: receipt.blockNumber,
    fetchStatus: fetchIndexerStatus,
    wait,
  });

  return {
    receipt,
    synced,
  };
}

export function useEvmWriteLifecycleConfig(): Config {
  return useConfig();
}
