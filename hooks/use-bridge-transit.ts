"use client";

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { getAddress, type Address } from "viem";
import { useAccount } from "wagmi";

import { KarPassportAbi } from "@/lib/contracts/abis.generated";
import {
  deriveBridgeTransitUi,
  isBridgeTransitActivePhase,
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
 * Live send path still owned by `useBridge`; this hook covers F5 and catch-up.
 */
export function useBridgeTransit(opts: {
  tokenId: string;
  /** Ponder custody chain (commerce). */
  ponderCustodyChain: number;
  enabled?: boolean;
}) {
  const { tokenId, ponderCustodyChain, enabled = true } = opts;
  const { address } = useAccount();
  const abortRef = useRef<AbortController | null>(null);

  const storeVersion = useSyncExternalStore(
    subscribeBridgeTransit,
    getBridgeTransitSnapshot,
    getBridgeTransitSnapshot,
  );

  const record = useMemo(() => {
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

  // Clear when indexer custody matches destination.
  useEffect(() => {
    if (!enabled || !address || !record) return;
    if (ponderCustodyChain === record.dstChainId) {
      removeBridgeTransit(address, tokenId);
    }
  }, [address, enabled, ponderCustodyChain, record, tokenId]);

  // Resume dst poll while in flight after refresh.
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

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const sentAt = record.sentAt;

    void (async () => {
      const deadline = sentAt + BRIDGE_DELIVERY_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (controller.signal.aborted) return;
        await reconcileOnce();
        const latest = getBridgeTransit(address, tokenId);
        if (
          latest == null ||
          latest.phase === "indexer_catchup" ||
          latest.phase === "delivered_on_chain" ||
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
  }, [
    address,
    enabled,
    reconcileOnce,
    record?.phase,
    record?.sentAt,
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
