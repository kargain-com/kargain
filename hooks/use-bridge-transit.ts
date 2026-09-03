"use client";

import { useActiveAccount, requireEvmSession } from "@/hooks/use-active-account";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { getAddress, type Address } from "viem";

import { getPassportDetailLive } from "@/app/actions/passport-detail";
import { useTxSync } from "@/hooks/use-tx-sync";
import { KarPassportAbi } from "@/lib/contracts/abis.generated";
import {
  deriveBridgeTransitUi,
  isBridgeDestinationCustodyIndexed,
  isBridgeTransitActivePhase,
  isBridgeTransitIndexerCatchupPhase,
  reconcileBridgeTransit,
} from "@/lib/passport/bridge-transit";
import {
  getBridgeTransit,
  getBridgeTransitSnapshot,
  hydrateBridgeTransitFromSession,
  removeBridgeTransit,
  subscribeBridgeTransit,
  upsertBridgeTransit,
} from "@/lib/passport/bridge-transit-store";
import {
  BRIDGE_DELIVERY_POLL_MS,
  BRIDGE_DELIVERY_TIMEOUT_MS,
  bridgeTokenAddress,
  getBridgeReadClient,
  layerZeroScanTxUrl,
} from "@/lib/web3/bridge";
import { shortChainName } from "@/lib/web3/supported-chains";
import {
  INDEXER_SYNC_INTERVAL_MS,
  INDEXER_SYNC_MAX_ATTEMPTS,
  pollUntil,
} from "@/lib/web3/tx-sync";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readDstOwner(
  tokenId: bigint,
  dstChainId: number,
): Promise<string | null> {
  const client = getBridgeReadClient(dstChainId);
  const token = bridgeTokenAddress(dstChainId);
  if (!token) return null;
  try {
    return getAddress(
      (await client.readContract({
        address: token,
        abi: KarPassportAbi,
        functionName: "ownerOf",
        args: [tokenId],
      })) as Address,
    );
  } catch {
    return null;
  }
}

/**
 * Recover + reconcile bridge transit for a passport detail page.
 * Live send path still owned by `useBridge`; this hook covers F5, dst delivery
 * resume, and indexer catch-up → `syncReads` (same post-truth path as `runTx`).
 */
export function useBridgeTransit(opts: {
  tokenId: string;
  /** Ponder custody chain (commerce). */
  ponderCustodyChain: number;
  enabled?: boolean;
}) {
  const { tokenId, ponderCustodyChain, enabled = true } = opts;
  const { account } = useActiveAccount();
  const evm = requireEvmSession(account);
  const address = evm.ok ? evm.address : undefined;
  const router = useRouter();
  // chainId unused by syncReads; commerce custody satisfies the hook shape.
  const { syncReads } = useTxSync(ponderCustodyChain);
  const deliveryAbortRef = useRef<AbortController | null>(null);
  const catchupAbortRef = useRef<AbortController | null>(null);

  const storeVersion = useSyncExternalStore(
    subscribeBridgeTransit,
    getBridgeTransitSnapshot,
    getBridgeTransitSnapshot,
  );

  const record = useMemo(() => {
    // External-store bump — forces recompute when transit records change.
    void storeVersion;
    if (!address || !enabled) return null;
    return getBridgeTransit(address, tokenId);
  }, [address, enabled, storeVersion, tokenId]);

  useEffect(() => {
    if (!enabled || !address) return;
    hydrateBridgeTransitFromSession(address, tokenId);
  }, [address, enabled, tokenId]);

  const reconcileOnce = useCallback(async () => {
    if (!address) return;
    const current = getBridgeTransit(address, tokenId);
    if (!current) return;

    const dstOwner = await readDstOwner(
      BigInt(current.tokenId),
      current.dstChainId,
    );
    const next = reconcileBridgeTransit(current, {
      now: Date.now(),
      dstOwner,
      ponderCustodyChain,
    });
    if (next == null) {
      removeBridgeTransit(address, current.tokenId);
      return;
    }
    if (next.phase !== current.phase) {
      upsertBridgeTransit(address, next);
    }
  }, [address, ponderCustodyChain, tokenId]);

  // Clear when RSC commerce custody already matches destination (post-refresh).
  useEffect(() => {
    if (!enabled || !address || !record) return;
    if (ponderCustodyChain === record.dstChainId) {
      removeBridgeTransit(address, tokenId);
    }
  }, [address, enabled, ponderCustodyChain, record, tokenId]);

  // Resume dst ownerOf poll while in flight after refresh.
  useEffect(() => {
    if (!enabled || !address || !record) return;
    const polling =
      record.phase === "source_confirmed" ||
      record.phase === "in_flight" ||
      record.phase === "submitting";
    if (!polling) {
      void reconcileOnce();
      return;
    }

    deliveryAbortRef.current?.abort();
    const controller = new AbortController();
    deliveryAbortRef.current = controller;
    const sentAt = record.sentAt;

    void (async () => {
      const deadline = sentAt + BRIDGE_DELIVERY_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (controller.signal.aborted) return;
        await reconcileOnce();
        const latest = getBridgeTransit(address, tokenId);
        if (
          latest == null ||
          isBridgeTransitIndexerCatchupPhase(latest.phase) ||
          latest.phase === "timed_out" ||
          latest.phase === "complete"
        ) {
          return;
        }
        await wait(BRIDGE_DELIVERY_POLL_MS);
      }
      await reconcileOnce();
    })();

    return () => {
      controller.abort();
    };
  }, [address, enabled, reconcileOnce, record, tokenId]);

  // Indexer catch-up: poll Ponder custody → syncReads → clear (mirrors runTx).
  useEffect(() => {
    if (!enabled || !address || !record) return;
    if (!isBridgeTransitIndexerCatchupPhase(record.phase)) return;
    if (ponderCustodyChain === record.dstChainId) return;

    catchupAbortRef.current?.abort();
    const controller = new AbortController();
    catchupAbortRef.current = controller;
    const dstChainId = record.dstChainId;

    void (async () => {
      const result = await pollUntil({
        poll: () => getPassportDetailLive(tokenId, dstChainId),
        predicate: (detail) =>
          isBridgeDestinationCustodyIndexed(detail, dstChainId),
        intervalMs: INDEXER_SYNC_INTERVAL_MS,
        maxAttempts: INDEXER_SYNC_MAX_ATTEMPTS,
        wait,
        shouldContinue: () => !controller.signal.aborted,
      });

      if (controller.signal.aborted) return;
      if (result.status !== "matched") return;

      // Same post-truth triad as runTx. Clear when RSC commerce custody updates
      // (existing effect) so idle Move/Return never flashes on stale src props.
      await syncReads();
      if (controller.signal.aborted) return;
      router.replace(`/marketplace/${tokenId}?chain=${dstChainId}`);
    })();

    return () => {
      controller.abort();
    };
  }, [
    address,
    enabled,
    ponderCustodyChain,
    record,
    router,
    syncReads,
    tokenId,
  ]);

  const dstName = record ? shortChainName(record.dstChainId) : "";
  const ui = record ? deriveBridgeTransitUi(record, dstName) : null;
  const scanUrl =
    record?.guid != null && record.guid.startsWith("0x")
      ? layerZeroScanTxUrl(record.guid as `0x${string}`)
      : null;

  const transitActive = Boolean(
    record && isBridgeTransitActivePhase(record.phase),
  );

  return {
    record,
    ui,
    scanUrl,
    transitActive,
  };
}
