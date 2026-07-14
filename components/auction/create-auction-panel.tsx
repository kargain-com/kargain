"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { parseEther, parseUnits, zeroAddress } from "viem";
import {
  useAccount,
  useChainId,
  useReadContract,
  useSwitchChain,
  useWriteContract,
  useConfig,
} from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";

import { Button } from "@/components/ui/button";
import { endsAtDateTimeAttr } from "@/lib/auction/format-auction";
import { parseOnChainHold } from "@/lib/auction/parse-on-chain-auction";
import { AuctionEscrowAbi, KarPassportAbi } from "@/lib/contracts/abis.generated";
import {
  elevatedAdvisoryPanel,
  elevatedAdvisoryText,
  monoTimestamp,
} from "@/lib/design/instrument-classes";
import { txErrorMessage } from "@/lib/marketplace/tx-error-message";
import type { PassportStatus } from "@/lib/types/ponder";
import {
  auctionEscrowAddress,
  karPassportAddress,
  usdcAddress,
} from "@/lib/web3/deployment-addresses";
import { wagmiChainId } from "@/lib/web3/supported-chains";
import { cn } from "@/lib/utils";

type Props = {
  chainId: number;
  tokenId: string;
  passportStatus: PassportStatus;
  listingActive: boolean;
  isOwner: boolean;
  isActiveVerifier: boolean;
  onSuccess?: () => void;
};

const THREE_DAYS = 3 * 24 * 60 * 60;
const SEVEN_DAYS = 7 * 24 * 60 * 60;

export function CreateAuctionPanel({
  chainId,
  tokenId,
  passportStatus,
  listingActive,
  isOwner,
  isActiveVerifier,
  onSuccess,
}: Props) {
  const router = useRouter();
  const config = useConfig();
  const { address, isConnected } = useAccount();
  const walletChainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync, isPending: isWriting } = useWriteContract();

  const [assetKind, setAssetKind] = useState<"ETH" | "USDC">("ETH");
  const [reserveStr, setReserveStr] = useState("");
  const [durationDays, setDurationDays] = useState(3);
  const [txError, setTxError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const escrow = auctionEscrowAddress(chainId);
  const passport = karPassportAddress(chainId);
  const usdc = usdcAddress(chainId);
  const wrongChain = walletChainId !== wagmiChainId(chainId);

  const { data: approvedForAll, refetch: refetchApproval } = useReadContract({
    address: passport,
    abi: KarPassportAbi,
    functionName: "isApprovedForAll",
    args: address && escrow ? [address, escrow] : undefined,
    chainId: wagmiChainId(chainId),
    query: { enabled: Boolean(address && passport && escrow) },
  });

  const { data: holdRaw } = useReadContract({
    address: escrow,
    abi: AuctionEscrowAbi,
    functionName: "holds",
    args: [BigInt(tokenId)],
    chainId: wagmiChainId(chainId),
    query: { enabled: Boolean(escrow && tokenId) },
  });

  const hold = parseOnChainHold(holdRaw);
  const settlementPending = Boolean(hold?.open && hold.releaseAt !== 0n);
  const settlementDate =
    settlementPending && hold
      ? (() => {
          const date = new Date(Number(hold.releaseAt) * 1000);
          return {
            label: date.toLocaleDateString("en-US", {
              year: "numeric",
              month: "short",
              day: "numeric",
            }),
            dateTime: endsAtDateTimeAttr(hold.releaseAt),
          };
        })()
      : null;

  const canShow =
    isConnected &&
    isOwner &&
    isActiveVerifier &&
    passportStatus === "VERIFIED" &&
    !listingActive &&
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
    await waitForTransactionReceipt(config, { hash });
    await refetchApproval();
  }

  async function onCreate() {
    setTxError(null);
    if (!escrow) return;
    if (settlementPending) {
      setTxError(
        "The previous sale of this vehicle is still settling. Try again after the hold ends.",
      );
      return;
    }

    const durationSec = durationDays * 24 * 60 * 60;
    if (durationSec < THREE_DAYS || durationSec > SEVEN_DAYS) {
      setTxError("Duration must be between 3 and 7 days.");
      return;
    }

    let reserve: bigint;
    try {
      reserve =
        assetKind === "ETH"
          ? parseEther(reserveStr.trim())
          : parseUnits(reserveStr.trim(), 6);
    } catch {
      setTxError("Enter a valid reserve amount.");
      return;
    }
    if (reserve <= 0n) {
      setTxError("Enter a valid reserve amount.");
      return;
    }

    if (assetKind === "USDC" && !usdc) {
      setTxError("USDC is not configured on this chain.");
      return;
    }

    setBusy(true);
    try {
      if (wrongChain) {
        await switchChainAsync({ chainId: wagmiChainId(chainId) });
      }
      await ensureApproval();
      const asset = assetKind === "ETH" ? zeroAddress : usdc!;
      const hash = await writeContractAsync({
        address: escrow,
        abi: AuctionEscrowAbi,
        functionName: "createAuction",
        args: [BigInt(tokenId), asset, reserve, durationSec],
        chainId: wagmiChainId(chainId),
      });
      await waitForTransactionReceipt(config, { hash });
      onSuccess?.();
      router.refresh();
    } catch (err) {
      setTxError(txErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 rounded-md border border-border-default bg-bg-surface p-4">
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
          disabled={busy || isWriting}
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
          disabled={busy || isWriting}
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

      {txError && (
        <p className="font-sans text-sm text-status-error" role="alert">
          {txError}
        </p>
      )}

      <Button
        type="button"
        className="w-full"
        disabled={
          busy || isWriting || !reserveStr.trim() || settlementPending
        }
        onClick={() => void onCreate()}
      >
        {busy || isWriting
          ? approvedForAll
            ? "Confirming…"
            : "Approving passport…"
          : "Start auction"}
      </Button>
    </div>
  );
}
