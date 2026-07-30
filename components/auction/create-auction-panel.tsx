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
import { TX_SYNC_LAG_ADVISORY, useTxSync } from "@/hooks/use-tx-sync";
import { useCommerceModePaused } from "@/hooks/use-commerce-mode-paused";
import { endsAtDateTimeAttr } from "@/lib/auction/format-auction";
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

const THREE_DAYS = 3 * 24 * 60 * 60;
const SEVEN_DAYS = 7 * 24 * 60 * 60;

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
  const [formError, setFormError] = useState<string | null>(null);

  const escrow = commerceModeAddress("ascending", chainId);
  const passport = karPassportAddress(chainId);
  const usdc = usdcAddress(chainId);
  const wrongChain = walletChainId !== wagmiChainId(chainId);
  const busy = phase !== "idle";
  const { paused: modePaused } = useCommerceModePaused({
    mode: "ascending",
    chainId,
  });

  const { data: approvedForAll, refetch: refetchApproval } = useReadContract({
    address: passport,
    abi: KarPassportAbi,
    functionName: "isApprovedForAll",
    args: address && escrow ? [address, escrow] : undefined,
    chainId: wagmiChainId(chainId),
    query: { enabled: Boolean(address && passport && escrow) },
  });

  const { data: unresolvedSettlement } = useReadContract({
    address: escrow,
    abi: AscendingConsignmentAbi,
    functionName: "hasUnresolvedSettlement",
    args: [BigInt(tokenId)],
    chainId: wagmiChainId(chainId),
    query: { enabled: Boolean(escrow && tokenId) },
  });

  const { data: protectionEndsAt } = useReadContract({
    address: escrow,
    abi: AscendingConsignmentAbi,
    functionName: "holdProtectionEndsAt",
    args: [BigInt(tokenId)],
    chainId: wagmiChainId(chainId),
    query: { enabled: Boolean(escrow && unresolvedSettlement === true) },
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
    Boolean(escrow && passport);

  if (!canShow) return null;

  async function ensureApproval() {
    if (!passport || !escrow || approvedForAll) return;
    const hash = await writeContractAsync({
      address: passport,
      abi: KarPassportAbi,
      functionName: "setApprovalForAll",
      args: [escrow, true],
      chainId: wagmiChainId(chainId),
    });
    await awaitReceipt(hash);
    await refetchApproval();
  }

  async function onCreate() {
    setFormError(null);
    if (!escrow) return;
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

    const durationSec = durationDays * 24 * 60 * 60;
    if (durationSec < THREE_DAYS || durationSec > SEVEN_DAYS) {
      setFormError("Duration must be between 3 and 7 days.");
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
        address: escrow,
        abi: AscendingConsignmentAbi,
        functionName: "openAscendingDirect",
        args: [BigInt(tokenId), asset, reserve, durationSec],
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
        Auctions are open to professional sellers with verified vehicles. The
        reserve is public and bidding starts at or above it.
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
          Lowest price you will accept. Shown to everyone.
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
          value={durationDays}
          onChange={(e) => setDurationDays(Number(e.target.value))}
          disabled={busy}
          className={cn(
            "w-full min-h-11 rounded-sm border border-border-default bg-bg-primary px-3",
            "font-mono text-sm tabular-nums text-text-primary",
            "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
          )}
        >
          {[3, 4, 5, 6, 7].map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
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
