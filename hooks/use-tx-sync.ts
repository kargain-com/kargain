"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

import { getIndexerBlockNumber } from "@/app/actions/indexer-status";
import { revalidateIndexerCache } from "@/app/actions/revalidate-indexer-cache";
import { useActiveAccount } from "@/hooks/use-active-account";
import { txErrorMessage } from "@/lib/marketplace/tx-error-message";
import {
  isEvmConfirmRefusal,
  type EvmConfirmRefusalOutcome,
} from "@/lib/web3/evm-tx-confirm";
import {
  isSvmConfirmRefusal,
  type SvmConfirmOutcome,
} from "@/lib/web3/svm-tx-confirm";
import {
  awaitWriteReceipt,
  runWriteLifecycle,
  useWriteLifecycleConfig,
} from "@/lib/web3/write-lifecycle";
import { invalidateIndexerQueries } from "@/lib/web3/indexer-query-keys";
import { TX_SYNC_LAG_ADVISORY } from "@/lib/web3/tx-sync";
import { type RunTxResult, type TxRefusal } from "@/lib/web3/tx-refusal";
import {
  isTxWriteGuardRefusal,
  txWriteGuardRefusalCopy,
} from "@/lib/web3/tx-write-availability";
import { type WriteOutcome, type WriteSubmission } from "@/lib/web3/write-outcome";
import { isWalletRejection, walletRejectionCopy } from "@/lib/web3/wallet-rejection";

export type { RunTxResult, TxRefusal };

export type TxSyncPhase = "idle" | "wallet" | "confirming" | "indexing";

export type TxSyncSuccess = WriteOutcome;

export type SyncReadsResult = { ok: boolean };

export { TX_SYNC_LAG_ADVISORY };

type TxSyncOptions = {
  mapError?: (err: unknown) => string;
};

function txRefusalFromSvmConfirm(
  outcome: Exclude<SvmConfirmOutcome, { kind: "landed_ok" }>,
): TxRefusal {
  switch (outcome.kind) {
    case "expired":
      return {
        kind: "expired",
        signature: outcome.signature,
        lastValidBlockHeight: outcome.lastValidBlockHeight,
        observedBlockHeight: outcome.observedBlockHeight,
      };
    case "status_unknown":
      return { kind: "status_unknown", writeReference: outcome.signature };
    case "landed_with_error":
      return {
        kind: "landed_with_error",
        signature: outcome.signature,
        slot: outcome.slot,
        error: outcome.error,
        failingProgram: outcome.failingProgram,
        landed: outcome.landed,
      };
    default: {
      const _never: never = outcome;
      return _never;
    }
  }
}

function txRefusalFromEvmConfirm(
  outcome: EvmConfirmRefusalOutcome,
): TxRefusal {
  switch (outcome.kind) {
    case "reverted":
      return {
        kind: "reverted",
        writeReference: outcome.hash,
        blockNumber: outcome.blockNumber,
        revertData: outcome.revertData,
      };
    case "superseded":
      return {
        kind: "superseded",
        writeReference: outcome.originalHash,
        replacementHash: outcome.replacementHash,
        reason: outcome.reason,
      };
    case "status_unknown":
      return { kind: "status_unknown", writeReference: outcome.hash };
    default: {
      const _never: never = outcome;
      return _never;
    }
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function useTxSync(chainId: number) {
  const config = useWriteLifecycleConfig();
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
        return await awaitWriteReceipt({
          account,
          chainId,
          config,
          hash,
          onPhase: setPhase,
        });
      } catch (err) {
        const message = (options?.mapError ?? txErrorMessage)(err);
        setError(message);
        if (isEvmConfirmRefusal(err)) {
          throw err;
        }
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
      writeFn: () => Promise<WriteSubmission>,
      options?: TxSyncOptions,
    ): Promise<RunTxResult> => {
      setError(null);
      setSyncLagged(false);
      activeRunDepthRef.current += 1;

      try {
        const lifecycle = await runWriteLifecycle({
          account,
          chainId,
          config,
          switchChain,
          writeFn,
          fetchIndexerStatus: () => getIndexerBlockNumber(chainId),
          wait,
          onPhase: setPhase,
        });

        const revalidate = await syncReads();
        setSyncLagged(
          lifecycle.indexerBarrier.status === "lagging" || !revalidate.ok,
        );
        return { ok: true, outcome: lifecycle };
      } catch (err) {
        if (isSvmConfirmRefusal(err)) {
          const refusal = txRefusalFromSvmConfirm(err.outcome);
          setError((options?.mapError ?? txErrorMessage)(err));
          return { ok: false, refusal };
        }
        if (isEvmConfirmRefusal(err)) {
          const refusal = txRefusalFromEvmConfirm(err.outcome);
          setError((options?.mapError ?? txErrorMessage)(err));
          return { ok: false, refusal };
        }
        if (isTxWriteGuardRefusal(err)) {
          setError(txWriteGuardRefusalCopy(err.refusal));
          return {
            ok: false,
            refusal: { kind: "guard_refused", refusal: err.refusal },
          };
        }
        if (isWalletRejection(err)) {
          setError(walletRejectionCopy());
          return { ok: false, refusal: { kind: "wallet_rejected" } };
        }
        // Preserve the thrown value; display via mapError only — never
        // encode cause tokens into TxRefusal.message.
        setError((options?.mapError ?? txErrorMessage)(err));
        return { ok: false, refusal: { kind: "write_refused", error: err } };
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
