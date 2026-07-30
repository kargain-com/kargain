"use client";

import { useState } from "react";
import { parseEther, parseUnits, zeroAddress } from "viem";
import {
  useAccount,
  useChainId,
  useReadContract,
  useWriteContract,
} from "wagmi";

import { Button } from "@/components/ui/button";
import { CommercePausedNotice } from "@/components/commerce/commerce-paused-notice";
import { useAscendingAuctionRules } from "@/hooks/use-ascending-auction-rules";
import { TX_SYNC_LAG_ADVISORY, useTxSync } from "@/hooks/use-tx-sync";
import { useCommerceModePaused } from "@/hooks/use-commerce-mode-paused";
import { endsAtDateTimeAttr } from "@/lib/auction/format-auction";
import {
  ASCENDING_RESERVE_HELP,
  ASCENDING_RESERVE_INTRO,
} from "@/lib/auction/ascending-public-claims";
import {
  durationBoundsErrorMessage,
  durationDayOptions,
  protectionBoundsErrorMessage,
} from "@/lib/commerce/format-window-duration";
import { commerceModeAddress } from "@/lib/commerce/mode";
import { commercePausedAnnouncementForMode } from "@/lib/commerce/pause-surface";
import {
  AscendingConsignmentAbi,
  KarPassportAbi,
} from "@/lib/contracts/abis.generated";
import {
  elevatedAdvisoryPanel,
  elevatedAdvisoryText,
  monoTimestamp,
} from "@/lib/design/instrument-classes";
import {
  karPassportAddress,
  usdcAddress,
} from "@/lib/web3/deployment-addresses";
import { wagmiChainId } from "@/lib/web3/supported-chains";
import { cn } from "@/lib/utils";

type Props = {
  chainId: number;
  tokenId: string;
  /** Derived by the sell surface: `may(OpenConsignment)` and no live sale. */
  canOpen: boolean;
  isOwner: boolean;
  isActiveVerifier: boolean;
};

export function CreateAuctionPanel({
  chainId,
  tokenId,
  canOpen,
  isOwner,
  isActiveVerifier,
}: Props) {
  const { address, isConnected } = useAccount();
  const walletChainId = useChainId();
  const { writeContractAsync } = useWriteContract();
  const { runTx, awaitReceipt, phase, error, syncLagged } = useTxSync(chainId);

  const [assetKind, setAssetKind] = useState<"ETH" | "USDC">("ETH");
  const [reserveStr, setReserveStr] = useState("");
  const [durationDays, setDurationDays] = useState(3);
  const [protectionDays, setProtectionDays] = useState(7);
  const [formError, setFormError] = useState<string | null>(null);

  const mode = commerceModeAddress("ascending", chainId);
  const passport = karPassportAddress(chainId);
  const usdc = usdcAddress(chainId);
  const wrongChain = walletChainId !== wagmiChainId(chainId);
  const busy = phase !== "idle";
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

  const { data: approvedForAll, refetch: refetchApproval } = useReadContract({
    address: passport,
    abi: KarPassportAbi,
    functionName: "isApprovedForAll",
    args: address && mode ? [address, mode] : undefined,
    chainId: wagmiChainId(chainId),
    query: { enabled: Boolean(address && passport && mode) },
  });

  const { data: unresolvedSettlement } = useReadContract({
    address: mode,
    abi: AscendingConsignmentAbi,
    functionName: "hasUnresolvedSettlement",
    args: [BigInt(tokenId)],
    chainId: wagmiChainId(chainId),
    query: { enabled: Boolean(mode && tokenId) },
  });

  const { data: protectionEndsAt } = useReadContract({
    address: mode,
    abi: AscendingConsignmentAbi,
    functionName: "holdProtectionEndsAt",
    args: [BigInt(tokenId)],
    chainId: wagmiChainId(chainId),
    query: { enabled: Boolean(mode && unresolvedSettlement === true) },
  });

  const settlementPending = unresolvedSettlement === true;
  const releaseAt =
    typeof protectionEndsAt === "bigint" ? protectionEndsAt : 0n;
  const settlementDate =
    settlementPending && releaseAt > 0n
      ? {
          label: new Date(Number(releaseAt) * 1000).toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
          }),
          dateTime: endsAtDateTimeAttr(releaseAt),
        }
      : null;

  const canShow =
    isConnected &&
    isOwner &&
    isActiveVerifier &&
    canOpen &&
    Boolean(mode && passport);

  if (!canShow) return null;

  async function ensureApproval() {
    if (!passport || !mode || approvedForAll) return;
    const hash = await writeContractAsync({
      address: passport,
      abi: KarPassportAbi,
      functionName: "setApprovalForAll",
      args: [mode, true],
      chainId: wagmiChainId(chainId),
    });
    await awaitReceipt(hash);
    await refetchApproval();
  }

  async function onCreate() {
    setFormError(null);
    if (!mode) return;
    if (modePaused === true) {
      setFormError(commercePausedAnnouncementForMode("ascending"));
      return;
    }
    if (settlementPending) {
      setFormError(
        "The previous sale of this vehicle is still settling. Try again after the hold ends.",
      );
      return;
    }

    if (!auctionRules) {
      setFormError("Loading auction rules…");
      return;
    }
    const durationSec = selectedDurationDays * 24 * 60 * 60;
    if (
      durationSec < auctionRules.minDuration ||
      durationSec > auctionRules.maxDuration
    ) {
      setFormError(
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
      setFormError(
        protectionBoundsErrorMessage(
          auctionRules.minProtectionWindow,
          auctionRules.maxProtectionWindow,
        ),
      );
      return;
    }

    let reserve: bigint;
    try {
      reserve =
        assetKind === "ETH"
          ? parseEther(reserveStr.trim())
          : parseUnits(reserveStr.trim(), 6);
    } catch {
      setFormError("Enter a valid reserve amount.");
      return;
    }
    if (reserve <= 0n) {
      setFormError("Enter a valid reserve amount.");
      return;
    }

    if (assetKind === "USDC" && !usdc) {
      setFormError("USDC is not configured on this chain.");
      return;
    }

    await runTx(async () => {
      await ensureApproval();
      const asset = assetKind === "ETH" ? zeroAddress : usdc!;
      return writeContractAsync({
        address: mode,
        abi: AscendingConsignmentAbi,
        functionName: "openAscendingDirect",
        args: [BigInt(tokenId), asset, reserve, durationSec, protectionSec],
        chainId: wagmiChainId(chainId),
      });
    });
  }

  return (
    <div className="space-y-4 rounded-md border border-border-default bg-bg-surface p-4">
      {modePaused === true ? <CommercePausedNotice mode="ascending" /> : null}

      {settlementPending && settlementDate && (
        <div className={elevatedAdvisoryPanel} role="status">
          <p className={cn("font-sans", elevatedAdvisoryText)}>
            This vehicle’s previous sale is still in its settlement window. You
            can start a new auction after{" "}
            <time
              dateTime={settlementDate.dateTime}
              className={cn(monoTimestamp, elevatedAdvisoryText)}
            >
              {settlementDate.label}
            </time>
            .
          </p>
        </div>
      )}

      <p className="font-sans text-sm text-text-secondary">
        {ASCENDING_RESERVE_INTRO}
      </p>

      <div className="space-y-2">
        <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-text-tertiary">
          Auction currency
        </p>
        <div className="flex gap-2">
          {(["ETH", "USDC"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => setAssetKind(kind)}
              className={cn(
                "min-h-11 flex-1 rounded-sm border px-3 font-sans text-sm font-medium transition-colors",
                "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
                assetKind === kind
                  ? "border-border-hover bg-bg-primary text-text-primary"
                  : "border-border-default text-text-secondary hover:border-border-hover",
              )}
            >
              {kind}
            </button>
          ))}
        </div>
        <p className="font-sans text-xs text-text-secondary">
          Bids and payout are in one currency for the whole auction. USDC is
          recommended for expensive vehicles.
        </p>
      </div>

      <div className="space-y-2">
        <label
          htmlFor="auction-reserve"
          className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-text-tertiary"
        >
          Reserve ({assetKind})
        </label>
        <input
          id="auction-reserve"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={reserveStr}
          onChange={(e) => setReserveStr(e.target.value)}
          disabled={busy}
          className={cn(
            "w-full min-h-11 rounded-sm border border-border-default bg-bg-primary px-3",
            "font-mono text-sm tabular-nums text-text-primary",
            "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
          )}
        />
        <p className="font-sans text-xs text-text-secondary">
          {ASCENDING_RESERVE_HELP}
        </p>
      </div>

      <div className="space-y-2">
        <label
          htmlFor="auction-duration"
          className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-text-tertiary"
        >
          Duration (days)
        </label>
        <select
          id="auction-duration"
          value={selectedDurationDays}
          onChange={(e) => setDurationDays(Number(e.target.value))}
          disabled={busy || durationOptions.length === 0}
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
          htmlFor="auction-protection"
          className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-text-tertiary"
        >
          Protection hold (days)
        </label>
        <select
          id="auction-protection"
          value={selectedProtectionDays}
          onChange={(e) => setProtectionDays(Number(e.target.value))}
          disabled={busy || protectionOptions.length === 0}
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
          After the winning bid settles, payment stays held for this long so
          the buyer can receive the vehicle and open a settlement challenge if
          needed.
        </p>
      </div>

      {wrongChain && (
        <p className="font-sans text-sm text-text-secondary">
          Switch to the correct network to start an auction.
        </p>
      )}

      {(formError ?? error) && (
        <p className="font-sans text-sm text-status-error" role="alert">
          {formError ?? error}
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
        disabled={busy || !reserveStr.trim() || settlementPending || modePaused === true}
        onClick={() => void onCreate()}
      >
        {phase === "indexing"
          ? "Confirming…"
          : busy
          ? approvedForAll
            ? "Confirming…"
            : "Approving passport…"
          : "Start auction"}
      </Button>
    </div>
  );
}
