"use client";

import { useMemo, useState } from "react";
import { useAccount, useChainId, useWriteContract } from "wagmi";

import { Button } from "@/components/ui/button";
import { CommercePausedNotice } from "@/components/commerce/commerce-paused-notice";
import { useAscendingAuctionRules } from "@/hooks/use-ascending-auction-rules";
import { useMandate } from "@/hooks/use-mandate";
import { useCommerceModePaused } from "@/hooks/use-commerce-mode-paused";
import { TX_SYNC_LAG_ADVISORY, useTxSync } from "@/hooks/use-tx-sync";
import { formatAuctionAmount } from "@/lib/auction/format-auction";
import { ASCENDING_PROTECTION_TRADE } from "@/lib/auction/ascending-public-claims";
import {
  auctionAssetLabelFromAddress,
  parseOwnerMinAsset,
} from "@/lib/auction/owner-min-asset";
import {
  agentedPriceMeetsFloor,
  computeAgentedSplit,
} from "@/lib/commerce/agented-split";
import { compensationFormLabel } from "@/lib/commerce/denomination";
import {
  durationBoundsErrorMessage,
  durationDayOptions,
  protectionBoundsErrorMessage,
} from "@/lib/commerce/format-window-duration";
import { canAgentOpenFromMandate } from "@/lib/commerce/mandate";
import { commerceModeAddress } from "@/lib/commerce/mode";
import { AscendingConsignmentAbi } from "@/lib/contracts/abis.generated";
import { txErrorMessage } from "@/lib/marketplace/tx-error-message";
import { wagmiChainId } from "@/lib/web3/supported-chains";
import { cn } from "@/lib/utils";

type Props = {
  chainId: number;
  tokenId: string;
  /** Local UI only (e.g. collapse). Sync is owned by `useTxSync`. */
  onSuccess?: () => void;
};

/**
 * Agent `openAscendingFromMandate` — asset, floor and compensation are fixed
 * by the owner's mandate; the agent chooses reserve, duration, and protection.
 */
export function AgentCreateAuctionPanel({
  chainId,
  tokenId,
  onSuccess,
}: Props) {
  const { address, isConnected } = useAccount();
  const walletChainId = useChainId();
  const { writeContractAsync, isPending: isWriting } = useWriteContract();
  const { runTx, phase, error, syncLagged } = useTxSync(chainId);

  const [reserveStr, setReserveStr] = useState("");
  const [durationDays, setDurationDays] = useState(3);
  const [protectionDays, setProtectionDays] = useState(7);
  const [txError, setTxError] = useState<string | null>(null);
  const busy = phase !== "idle";

  const mode = commerceModeAddress("ascending", chainId);
  const wrongChain = walletChainId !== wagmiChainId(chainId);
  const { paused: modePaused } = useCommerceModePaused({
    mode: "ascending",
    chainId,
  });
  const { rules: auctionRules } = useAscendingAuctionRules({ chainId });
  const durationOptions = auctionRules
    ? durationDayOptions(auctionRules.minDuration, auctionRules.maxDuration)
    : [];
  const protectionOptions = auctionRules
    ? durationDayOptions(
        auctionRules.minProtectionWindow,
        auctionRules.maxProtectionWindow,
      )
    : [];
  const selectedDurationDays =
    durationOptions.length > 0 && !durationOptions.includes(durationDays)
      ? durationOptions[0]!
      : durationDays;
  const selectedProtectionDays =
    protectionOptions.length > 0 && !protectionOptions.includes(protectionDays)
      ? protectionOptions[0]!
      : protectionDays;
  const tid = useMemo(() => {
    try {
      return BigInt(tokenId);
    } catch {
      return 0n;
    }
  }, [tokenId]);

  const { mandate, platformFeeBps, isPending: mandatePending } = useMandate({
    mode: "ascending",
    chainId,
    tokenId,
  });

  const nowSec = Math.floor(Date.now() / 1000);
  const usable = canAgentOpenFromMandate({
    mandate,
    agentAddress: address,
    nowSeconds: nowSec,
  });

  const assetLabel = auctionAssetLabelFromAddress(mandate?.asset);
  const reserve = useMemo(
    () => parseOwnerMinAsset(reserveStr, assetLabel),
    [reserveStr, assetLabel],
  );

  const meetsFloor = agentedPriceMeetsFloor({
    price: reserve,
    floor: mandate?.floor ?? 0n,
    compensationForm: mandate?.compensationForm ?? 0,
    commissionBps: mandate?.commissionBps ?? 0,
    platformFeeBps,
  });

  const breakdown =
    reserve != null && reserve > 0n && mandate && platformFeeBps != null
      ? computeAgentedSplit({
          settled: reserve,
          floor: mandate.floor,
          compensationForm: mandate.compensationForm,
          commissionBps: mandate.commissionBps,
          platformFeeBps,
        })
      : null;

  if (!mode) return null;

  if (mandatePending || mandate === undefined) {
    return (
      <p className="rounded-md border border-border-default bg-bg-surface p-4 text-sm text-text-secondary">
        Loading mandate…
      </p>
    );
  }

  if (!isConnected || !usable || !mandate) {
    return (
      <p className="rounded-md border border-border-default bg-bg-surface p-4 text-sm text-text-secondary">
        You do not hold an active mandate for this vehicle, or it expired.
      </p>
    );
  }

  async function onCreate() {
    setTxError(null);
    if (!mode || !mandate || !usable) return;

    if (!auctionRules) {
      setTxError("Loading auction rules…");
      return;
    }
    const durationSec = selectedDurationDays * 24 * 60 * 60;
    if (
      durationSec < auctionRules.minDuration ||
      durationSec > auctionRules.maxDuration
    ) {
      setTxError(
        durationBoundsErrorMessage(
          auctionRules.minDuration,
          auctionRules.maxDuration,
        ),
      );
      return;
    }
    const protectionSec = selectedProtectionDays * 24 * 60 * 60;
    if (
      protectionSec < auctionRules.minProtectionWindow ||
      protectionSec > auctionRules.maxProtectionWindow
    ) {
      setTxError(
        protectionBoundsErrorMessage(
          auctionRules.minProtectionWindow,
          auctionRules.maxProtectionWindow,
        ),
      );
      return;
    }
    if (reserve == null || reserve <= 0n) {
      setTxError("Enter a valid reserve amount.");
      return;
    }
    if (platformFeeBps == null) {
      setTxError("Loading platform fee…");
      return;
    }
    if (!meetsFloor) {
      setTxError(txErrorMessage(new Error("BelowFloor")));
      return;
    }

    const succeeded = await runTx(() =>
      writeContractAsync({
        address: mode,
        abi: AscendingConsignmentAbi,
        functionName: "openAscendingFromMandate",
        args: [tid, reserve, durationSec, protectionSec],
        chainId: wagmiChainId(chainId),
      }),
    );
    if (succeeded) onSuccess?.();
  }

  return (
    <div className="space-y-4 rounded-md border border-border-default bg-bg-surface p-4">
      {modePaused === true ? <CommercePausedNotice mode="ascending" /> : null}

      <div>
        <p className="font-sans text-xs font-medium uppercase tracking-[0.12em] text-text-tertiary">
          Start auction on behalf
        </p>
        <p className="mt-2 font-sans text-sm text-text-secondary">
          Currency is locked to{" "}
          <span className="font-mono tabular-nums text-text-primary">
            {assetLabel}
          </span>
          . Owner floor{" "}
          <span className="font-mono tabular-nums text-text-primary">
            {formatAuctionAmount(mandate.floor, assetLabel)}
          </span>
          . Compensation{" "}
          <span className="text-text-primary">
            {compensationFormLabel(mandate.compensationForm)}
          </span>
          .
        </p>
      </div>

      <div className="space-y-2">
        <label
          htmlFor="agent-auction-reserve"
          className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-text-tertiary"
        >
          Reserve ({assetLabel})
        </label>
        <input
          id="agent-auction-reserve"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={reserveStr}
          onChange={(e) => setReserveStr(e.target.value)}
          disabled={busy || isWriting}
          className={cn(
            "w-full min-h-11 rounded-sm border border-border-default bg-bg-primary px-3",
            "font-mono text-sm tabular-nums text-text-primary",
            "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
          )}
        />
        <p className="font-sans text-xs text-text-secondary">
          Lowest price the owner will accept. Shown to everyone.
        </p>
      </div>

      <div className="space-y-2">
        <label
          htmlFor="agent-auction-duration"
          className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-text-tertiary"
        >
          Duration (days)
        </label>
        <select
          id="agent-auction-duration"
          value={selectedDurationDays}
          onChange={(e) => setDurationDays(Number(e.target.value))}
          disabled={busy || isWriting || durationOptions.length === 0}
          className={cn(
            "w-full min-h-11 rounded-sm border border-border-default bg-bg-primary px-3",
            "font-mono text-sm tabular-nums text-text-primary",
            "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
          )}
        >
          {durationOptions.length > 0
            ? durationOptions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))
            : (
                <option value={selectedDurationDays}>
                  {selectedDurationDays}
                </option>
              )}
        </select>
      </div>

      <div className="space-y-2">
        <label
          htmlFor="agent-auction-protection"
          className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-text-tertiary"
        >
          Protection hold (days)
        </label>
        <select
          id="agent-auction-protection"
          value={selectedProtectionDays}
          onChange={(e) => setProtectionDays(Number(e.target.value))}
          disabled={busy || isWriting || protectionOptions.length === 0}
          className={cn(
            "w-full min-h-11 rounded-sm border border-border-default bg-bg-primary px-3",
            "font-mono text-sm tabular-nums text-text-primary",
            "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
          )}
        >
          {protectionOptions.length > 0
            ? protectionOptions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))
            : (
                <option value={selectedProtectionDays}>
                  {selectedProtectionDays}
                </option>
              )}
        </select>
        <p className="font-sans text-xs text-text-secondary">
          After settle, payment stays held for this long so the buyer can
          receive the vehicle and open a settlement challenge if needed.{" "}
          {ASCENDING_PROTECTION_TRADE}
        </p>
      </div>

      {breakdown && reserve != null && (
        <p className="rounded-md border border-border-default bg-bg-primary p-3 font-sans text-sm text-text-secondary">
          At reserve{" "}
          <span className="font-mono tabular-nums text-text-primary">
            {formatAuctionAmount(reserve, assetLabel)}
          </span>
          : you receive{" "}
          <span className="font-mono tabular-nums text-text-primary">
            {formatAuctionAmount(breakdown.agentAmount, assetLabel)}
          </span>
          , owner receives{" "}
          <span className="font-mono tabular-nums text-text-primary">
            {formatAuctionAmount(breakdown.ownerAmount, assetLabel)}
          </span>
          .
        </p>
      )}

      {reserve != null && platformFeeBps != null && !meetsFloor && (
        <p className="text-sm text-status-error" role="alert">
          At this reserve the owner would receive less than their mandate floor.
          Raise the reserve.
        </p>
      )}

      {wrongChain && (
        <p className="font-sans text-sm text-text-secondary">
          Switch to the correct network to start an auction.
        </p>
      )}

      {(txError ?? error) && (
        <p className="font-sans text-sm text-status-error" role="alert">
          {txError ?? error}
        </p>
      )}
      {syncLagged && (
        <p role="status" className="font-sans text-xs text-text-tertiary">
          {TX_SYNC_LAG_ADVISORY}
        </p>
      )}

      <Button
        type="button"
        className="w-full"
        disabled={
          modePaused === true ||
          busy ||
          isWriting ||
          !reserveStr.trim() ||
          !meetsFloor ||
          platformFeeBps == null
        }
        onClick={() => void onCreate()}
      >
        {phase === "indexing" || busy || isWriting
          ? "Confirming…"
          : "Start auction"}
      </Button>
    </div>
  );
}
