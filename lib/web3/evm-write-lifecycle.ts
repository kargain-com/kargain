"use client";

import { useConfig } from "wagmi";
import type { Config } from "wagmi";
import { getAddress, parseEventLogs, type TransactionReceipt } from "viem";

import { claimRecordedFromReceipt } from "@/lib/claims/receipt-claims";
import {
  KarPassportAbi,
  KarPassportBridgeGatewayAbi,
} from "@/lib/contracts/abis.generated";
import {
  evmSwitchChainAvailability,
  type ActiveAccount,
} from "@/lib/web3/active-account";
import { onftSentGuidFromLogs } from "@/lib/web3/bridge/bridge-guid";
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
import {
  buildWriteOutcome,
  type BridgeSendGuidWriteFact,
  type PassportMintedWriteFact,
  type WriteOutcome,
} from "@/lib/web3/write-outcome";

export type EvmWriteLifecyclePhase = "wallet" | "confirming" | "indexing";

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

function passportMintedFromReceipt(
  receipt: TransactionReceipt,
): PassportMintedWriteFact {
  const parsed = parseEventLogs({
    abi: KarPassportAbi,
    logs: receipt.logs,
    eventName: "PassportMinted",
  });
  const minted = parsed[0];
  if (!minted || minted.eventName !== "PassportMinted") {
    return { ok: false, cause: "missing_minted_passport" };
  }
  return { ok: true, tokenId: minted.args.tokenId.toString() };
}

function bridgeSendGuidFromReceipt(
  receipt: TransactionReceipt,
): BridgeSendGuidWriteFact {
  try {
    return {
      ok: true,
      guid: onftSentGuidFromLogs(KarPassportBridgeGatewayAbi, receipt.logs),
    };
  } catch {
    return { ok: false, cause: "missing_bridge_send_guid" };
  }
}

function claimRecipientsFromReceipt(
  receipt: TransactionReceipt,
): readonly string[] {
  return claimRecordedFromReceipt(receipt).map((claim) => getAddress(claim.account));
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
}: RunEvmWriteLifecycleOptions): Promise<WriteOutcome> {
  const avail = txWriteAvailability(account, chainId);
  if (!avail.available) {
    throw new Error(txWriteRefusalMessage(avail.cause));
  }

  onPhase?.("wallet");
  const targetChainId = resolveTargetChainId(chainId);
  if (avail.vm !== "evm") {
    throw new Error(txWriteRefusalMessage("wrong_vm"));
  }
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

  return buildWriteOutcome({
    writeReference: receipt.transactionHash,
    indexerBarrier: { status: synced ? "observed" : "lagging" },
    claimRecipients: claimRecipientsFromReceipt(receipt),
    mintedPassportTokenId: passportMintedFromReceipt(receipt),
    bridgeSendGuid: bridgeSendGuidFromReceipt(receipt),
  });
}

export function useEvmWriteLifecycleConfig(): Config {
  return useConfig();
}
