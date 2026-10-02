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
import { requireEvmCommercialActive, evmChainOf, type Eip155ChainId } from "@/lib/web3/commercial-active";
import { onftSentGuidFromLogs } from "@/lib/web3/bridge/bridge-guid";
import {
  confirmEvmTransaction,
  EvmConfirmRefusal,
  type EvmConfirmOutcome,
} from "@/lib/web3/evm-tx-confirm";
import {
  waitForIndexerBlock,
  type IndexerBlockNumberResult,
} from "@/lib/web3/tx-sync";
import {
  txWriteAvailability,
  TxWriteGuardRefusal,
} from "@/lib/web3/tx-write-availability";
import {
  buildWriteOutcome,
  isSvmWriteSubmission,
  type BridgeSendGuidWriteFact,
  type PassportMintedWriteFact,
  type WriteOutcome,
  type WriteSubmission,
} from "@/lib/web3/write-outcome";

export type EvmWriteLifecyclePhase = "wallet" | "confirming" | "indexing";

type ConfirmEvmTransactionFn = (
  config: Config,
  hash: `0x${string}`,
  chainId: number,
) => Promise<EvmConfirmOutcome>;

type EvmReceiptAwaitOptions = {
  account: ActiveAccount;
  chainId: number;
  config: Config;
  hash: `0x${string}`;
  onPhase?: (phase: EvmWriteLifecyclePhase) => void;
  confirmTransaction?: ConfirmEvmTransactionFn;
};

type RunEvmWriteLifecycleOptions = {
  account: ActiveAccount;
  chainId: number;
  config: Config;
  switchChain: (chainId: Eip155ChainId) => Promise<void>;
  writeFn: () => Promise<WriteSubmission>;
  fetchIndexerStatus: () => Promise<IndexerBlockNumberResult>;
  wait: (ms: number) => Promise<void>;
  onPhase?: (phase: EvmWriteLifecyclePhase) => void;
  confirmTransaction?: ConfirmEvmTransactionFn;
};

function assertEvmWriteSubmission(submission: WriteSubmission): `0x${string}` {
  if (isSvmWriteSubmission(submission)) {
    throw new Error("EVM write lifecycle received an SVM submission.");
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(submission)) {
    throw new Error("Transaction hash is not a valid EVM hash.");
  }
  return submission;
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

function requireLandedOk(outcome: EvmConfirmOutcome): TransactionReceipt {
  if (outcome.kind === "landed_ok") {
    return outcome.receipt;
  }
  throw new EvmConfirmRefusal(outcome);
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
    throw new TxWriteGuardRefusal({
      guard: "write_availability",
      refusal: avail,
    });
  }
  if (avail.vm !== "evm") {
    throw new TxWriteGuardRefusal({
      guard: "write_availability",
      refusal: { available: false, cause: "wrong_vm", wanted: "evm" },
    });
  }
  onPhase?.("confirming");
  return requireLandedOk(
    await confirmTransaction(config, hash, avail.targetChainId),
  );
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
}: RunEvmWriteLifecycleOptions): Promise<WriteOutcome> {
  const avail = txWriteAvailability(account, chainId);
  if (!avail.available) {
    throw new TxWriteGuardRefusal({
      guard: "write_availability",
      refusal: avail,
    });
  }

  onPhase?.("wallet");
  if (avail.vm !== "evm") {
    // EVM lifecycle always targets an EVM stack — name the family explicitly.
    throw new TxWriteGuardRefusal({
      guard: "write_availability",
      refusal: { available: false, cause: "wrong_vm", wanted: "evm" },
    });
  }
  const targetChainId = avail.targetChainId;
  if (avail.walletChainId !== targetChainId) {
    const switchAvail = evmSwitchChainAvailability(account);
    if (!switchAvail.available) {
      throw new TxWriteGuardRefusal({
        guard: "switch_chain",
        refusal: switchAvail,
      });
    }
    // EVM-by-construction after avail.vm === "evm" — branded Eip155 for ActiveAccount.
    await switchChain(evmChainOf(requireEvmCommercialActive(targetChainId)));
  }

  const txHash = assertEvmWriteSubmission(await writeFn());

  onPhase?.("confirming");
  const receipt = requireLandedOk(
    await confirmTransaction(config, txHash, targetChainId),
  );

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
