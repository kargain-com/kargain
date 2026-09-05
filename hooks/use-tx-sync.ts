"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

import { getIndexerBlockNumber } from "@/app/actions/indexer-status";
import { revalidateIndexerCache } from "@/app/actions/revalidate-indexer-cache";
import { useActiveAccount } from "@/hooks/use-active-account";
import { txErrorMessage } from "@/lib/marketplace/tx-error-message";
import {
  awaitEvmWriteReceipt,
  runEvmWriteLifecycle,
  useEvmWriteLifecycleConfig,
  type EvmWriteLifecycleSuccess,
} from "@/lib/web3/evm-write-lifecycle";
import { invalidateIndexerQueries } from "@/lib/web3/indexer-query-keys";
import { TX_SYNC_LAG_ADVISORY } from "@/lib/web3/tx-sync";

export type TxSyncPhase = "idle" | "wallet" | "confirming" | "indexing";

export type TxSyncSuccess = Pick<EvmWriteLifecycleSuccess, "receipt" | "synced">;

export type TxSyncResult = TxSyncSuccess | false;

export type SyncReadsResult = { ok: boolean };

export { TX_SYNC_LAG_ADVISORY };

type TxSyncOptions = {
  mapError?: (err: unknown) => string;
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function useTxSync(chainId: number) {
  const config = useEvmWriteLifecycleConfig();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { account, switchChain } = useActiveAccount();
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
      try {
        return await awaitEvmWriteReceipt({
          account,
          chainId,
          config,
          hash,
          onPhase: setPhase,
        });
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
      activeRunDepthRef.current += 1;

      try {
        const lifecycle = await runEvmWriteLifecycle({
          account,
          chainId,
          config,
          switchChain,
          writeFn,
          fetchIndexerStatus: () => getIndexerBlockNumber(chainId),
          wait,
          onPhase: setPhase,
        });

        const synced = lifecycle.synced;
        const revalidate = await syncReads();
        setSyncLagged(!synced || !revalidate.ok);
        return { receipt: lifecycle.receipt, synced };
      } catch (err) {
        setError((options?.mapError ?? txErrorMessage)(err));
        return false;
      } finally {
        activeRunDepthRef.current -= 1;
        setPhase("idle");
      }
    },
    [account, chainId, config, syncReads, switchChain],
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
