"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import type { TransactionReceipt } from "viem";
import { useConfig } from "wagmi";

import { getIndexerBlockNumber } from "@/app/actions/indexer-status";
import { revalidateIndexerCache } from "@/app/actions/revalidate-indexer-cache";
import {
  useActiveAccount,
  evmSwitchChainAvailability,
} from "@/hooks/use-active-account";
import { txErrorMessage } from "@/lib/marketplace/tx-error-message";
import { confirmEvmTransaction } from "@/lib/web3/evm-tx-confirm";
import { invalidateIndexerQueries } from "@/lib/web3/indexer-query-keys";
import { wagmiChainId } from "@/lib/web3/supported-chains";
import {
  TX_SYNC_LAG_ADVISORY,
  waitForIndexerBlock,
} from "@/lib/web3/tx-sync";
import {
  txWriteAvailability,
  txWriteRefusalMessage,
} from "@/lib/web3/tx-write-availability";

export type TxSyncPhase = "idle" | "wallet" | "confirming" | "indexing";

export type TxSyncSuccess = {
  receipt: TransactionReceipt;
  synced: boolean;
};

export type TxSyncResult = TxSyncSuccess | false;

export type SyncReadsResult = { ok: boolean };

export { TX_SYNC_LAG_ADVISORY };

type TxSyncOptions = {
  mapError?: (err: unknown) => string;
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isEvmTxHash(value: string): value is `0x${string}` {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

export function useTxSync(chainId: number) {
  const config = useConfig();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { account, switchChain } = useActiveAccount();
  const writeAvail = txWriteAvailability(account, chainId);
  const walletChainId = writeAvail.available
    ? writeAvail.walletChainId
    : undefined;
  const switchAvail = evmSwitchChainAvailability(account);
  const [phase, setPhase] = useState<TxSyncPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [syncLagged, setSyncLagged] = useState(false);
  const [flowActive, setFlowActive] = useState(false);
  const activeRunDepthRef = useRef(0);
  const flowDepthRef = useRef(0);

  const runFlow = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (flowDepthRef.current > 0) return undefined;
    flowDepthRef.current += 1;
    setFlowActive(true);
    try {
      return await fn();
    } finally {
      flowDepthRef.current -= 1;
      setFlowActive(flowDepthRef.current > 0);
    }
  }, []);

  const awaitReceipt = useCallback(
    async (hash: `0x${string}`, options?: TxSyncOptions) => {
      const nested = activeRunDepthRef.current > 0;
      if (!nested) {
        setError(null);
        setSyncLagged(false);
      }
      const avail = txWriteAvailability(account, chainId);
      if (!avail.available) {
        const message = txWriteRefusalMessage(avail.cause);
        setError(message);
        throw new Error(message);
      }
      setPhase("confirming");
      try {
        return await confirmEvmTransaction(config, hash);
      } catch (err) {
        const message = (options?.mapError ?? txErrorMessage)(err);
        setError(message);
        throw new Error(message);
      } finally {
        setPhase(nested ? "wallet" : "idle");
      }
    },
    [account, chainId, config],
  );

  /**
   * Sole client-read refresh after indexer truth advanced.
   * Order: updateTag (Next Data Cache) → RQ invalidate → router.refresh.
   * Revalidation failure surfaces via `syncLagged` (same advisory as indexer lag).
   */
  const syncReads = useCallback(async (): Promise<SyncReadsResult> => {
    let revalidateOk = true;
    try {
      const result = await revalidateIndexerCache();
      revalidateOk = result.ok;
    } catch {
      revalidateOk = false;
    }

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["readContract"] }),
      queryClient.invalidateQueries({ queryKey: ["readContracts"] }),
      invalidateIndexerQueries(queryClient),
    ]);
    router.refresh();

    if (!revalidateOk) setSyncLagged(true);
    return { ok: revalidateOk };
  }, [queryClient, router]);

  const runTx = useCallback(
    async (
      writeFn: () => Promise<string>,
      options?: TxSyncOptions,
    ): Promise<TxSyncResult> => {
      setError(null);
      setSyncLagged(false);
      setPhase("wallet");
      activeRunDepthRef.current += 1;

      try {
        const avail = txWriteAvailability(account, chainId);
        if (!avail.available) {
          throw new Error(txWriteRefusalMessage(avail.cause));
        }

        const targetChainId = wagmiChainId(chainId);
        if (walletChainId !== targetChainId) {
          if (!switchAvail.available) {
            throw new Error(`switchChain unavailable: ${switchAvail.cause}`);
          }
          await switchChain(chainId);
        }

        const hash = await writeFn();
        if (!isEvmTxHash(hash)) {
          throw new Error("Transaction hash is not a valid EVM hash.");
        }
        setPhase("confirming");
        const receipt = await confirmEvmTransaction(config, hash);

        setPhase("indexing");
        const { synced } = await waitForIndexerBlock({
          targetBlock: receipt.blockNumber,
          fetchStatus: () => getIndexerBlockNumber(chainId),
          wait,
        });

        const revalidate = await syncReads();
        setSyncLagged(!synced || !revalidate.ok);
        return { receipt, synced };
      } catch (err) {
        setError((options?.mapError ?? txErrorMessage)(err));
        return false;
      } finally {
        activeRunDepthRef.current -= 1;
        setPhase("idle");
      }
    },
    [account, chainId, config, syncReads, switchChain, walletChainId, switchAvail],
  );

  const busy = phase !== "idle" || flowActive;

  return {
    runTx,
    awaitReceipt,
    runFlow,
    syncReads,
    phase,
    busy,
    error,
    syncLagged,
  };
}
