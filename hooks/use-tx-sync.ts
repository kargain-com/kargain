"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import type { TransactionReceipt } from "viem";
import { useChainId, useConfig, useSwitchChain } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";

import { getIndexerBlockNumber } from "@/app/actions/indexer-status";
import { txErrorMessage } from "@/lib/marketplace/tx-error-message";
import { invalidateIndexerQueries } from "@/lib/web3/indexer-query-keys";
import { wagmiChainId } from "@/lib/web3/supported-chains";
import {
  TX_SYNC_LAG_ADVISORY,
  waitForIndexerBlock,
} from "@/lib/web3/tx-sync";

export type TxSyncPhase = "idle" | "wallet" | "confirming" | "indexing";

export type TxSyncSuccess = {
  receipt: TransactionReceipt;
  synced: boolean;
};

export type TxSyncResult = TxSyncSuccess | false;

export { TX_SYNC_LAG_ADVISORY };

type TxSyncOptions = {
  mapError?: (err: unknown) => string;
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function useTxSync(chainId: number) {
  const config = useConfig();
  const queryClient = useQueryClient();
  const router = useRouter();
  const walletChainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
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
      setPhase("confirming");
      try {
        return await waitForTransactionReceipt(config, { hash });
      } catch (err) {
        const message = (options?.mapError ?? txErrorMessage)(err);
        setError(message);
        throw new Error(message);
      } finally {
        setPhase(nested ? "wallet" : "idle");
      }
    },
    [config],
  );

  /**
   * Sole client-read refresh after indexer truth advanced without a new wallet
   * write (e.g. bridge destination custody). Same invalidate + route refresh as
   * `runTx` post-sync — does not move `phase` / busy.
   */
  const syncReads = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["readContract"] }),
      queryClient.invalidateQueries({ queryKey: ["readContracts"] }),
      invalidateIndexerQueries(queryClient),
    ]);
    router.refresh();
  }, [queryClient, router]);

  const runTx = useCallback(
    async (
      writeFn: () => Promise<`0x${string}`>,
      options?: TxSyncOptions,
    ): Promise<TxSyncResult> => {
      setError(null);
      setSyncLagged(false);
      setPhase("wallet");
      activeRunDepthRef.current += 1;

      try {
        const targetChainId = wagmiChainId(chainId);
        if (walletChainId !== targetChainId) {
          await switchChainAsync({ chainId: targetChainId });
        }

        const hash = await writeFn();
        setPhase("confirming");
        const receipt = await waitForTransactionReceipt(config, { hash });

        setPhase("indexing");
        const { synced } = await waitForIndexerBlock({
          targetBlock: receipt.blockNumber,
          fetchStatus: () => getIndexerBlockNumber(chainId),
          wait,
        });

        await syncReads();
        setSyncLagged(!synced);
        return { receipt, synced };
      } catch (err) {
        setError((options?.mapError ?? txErrorMessage)(err));
        return false;
      } finally {
        activeRunDepthRef.current -= 1;
        setPhase("idle");
      }
    },
    [
      chainId,
      config,
      syncReads,
      switchChainAsync,
      walletChainId,
    ],
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
