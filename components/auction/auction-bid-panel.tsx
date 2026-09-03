"use client";

import { useActiveAccount, requireEvmSession } from "@/hooks/use-active-account";

import { useState } from "react";
import { useBalance, useReadContract, useWriteContract } from "wagmi";

import { Button } from "@/components/ui/button";
import { CommercePausedNotice } from "@/components/commerce/commerce-paused-notice";
import { EnsWalletLink } from "@/components/ui/ens-wallet-link";
import { WalletLoginButton } from "@/components/wallet-login-button";
import { TX_SYNC_LAG_ADVISORY, useTxSync } from "@/hooks/use-tx-sync";
import { minNextBid } from "@/lib/auction/auction-bid-math";
import { formatExtensionHelp } from "@/lib/auction/auction-live-signals";
import {
  ASCENDING_BID_HELD,
  ASCENDING_S1_HELP,
} from "@/lib/auction/ascending-public-claims";
import { formatAuctionAmount } from "@/lib/auction/format-auction";
import type { AuctionRow, AuctionUiState } from "@/lib/auction/map-ponder-auction";
import { parseOwnerMinAsset } from "@/lib/auction/owner-min-asset";
import { isZeroAddress } from "@/lib/commerce/consignment";
import { formatWindowDurationLabel } from "@/lib/commerce/format-window-duration";
import { commerceModeAddress } from "@/lib/commerce/mode";
import { AscendingConsignmentAbi } from "@/lib/contracts/abis.generated";
import {
  formatBidTooLowMessage,
  txErrorMessage,
} from "@/lib/marketplace/tx-error-message";
import { wagmiChainId } from "@/lib/web3/supported-chains";
import { cn } from "@/lib/utils";

const ERC20_ABI = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

type Props = {
  chainId: number;
  tokenId: string;
  auction: AuctionRow;
  uiState: AuctionUiState;
  minIncrementBps: number;
  /** Chain `paused()` — `undefined` while unread (do not invent running). */
  paused: boolean | undefined;
  /** Chain extensionWindow seconds — drives live help copy. */
  extensionWindow?: bigint;
  /** Transient extension line (synced with readout flash). */
  extensionFlash?: string | null;
  /** Lot snapshotted protection length (seconds) — disclosed before bid. */
  protectionWindowSec?: number | null;
};

export function AuctionBidPanel({
  chainId,
  tokenId,
  auction,
  uiState,
  minIncrementBps,
  paused,
  extensionWindow = 300n,
  extensionFlash = null,
  protectionWindowSec = null,
}: Props) {
  const { account } = useActiveAccount();
  const evm = requireEvmSession(account);
  const address = evm.ok ? evm.address : undefined;
  const isConnected = evm.ok;
  const walletChainId = evm.ok ? evm.chainId : undefined;

      const { writeContractAsync, isPending: isWriting } = useWriteContract();
  const { runTx, awaitReceipt, runFlow, phase, busy, error, syncLagged } =
    useTxSync(chainId);

  const [amountStr, setAmountStr] = useState("");
  const [txError, setTxError] = useState<string | null>(null);

  const mode = commerceModeAddress("ascending", chainId);
  const isUsdcAuction = auction.assetLabel === "USDC";
  const usdc =
    isUsdcAuction &&
    auction.asset.startsWith("0x") &&
    !isZeroAddress(auction.asset)
      ? (auction.asset as `0x${string}`)
      : undefined;
  const assetLabel = auction.assetLabel;

  const { data: ethBalance } = useBalance({
    address,
    chainId: wagmiChainId(chainId),
    query: { enabled: Boolean(address && mode && !isUsdcAuction) },
  });

  const { data: usdcBalance, refetch: refetchUsdcBalance } = useReadContract({
    address: usdc,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: wagmiChainId(chainId),
    query: { enabled: Boolean(address && usdc && isUsdcAuction) },
  });

  const { data: usdcAllowance, refetch: refetchUsdcAllowance } = useReadContract({
    address: usdc,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: address && mode ? [address, mode] : undefined,
    chainId: wagmiChainId(chainId),
    query: { enabled: Boolean(address && usdc && mode && isUsdcAuction) },
  });

  const parsedAmount = parseOwnerMinAsset(amountStr, assetLabel);
  const needsUsdcApproval =
    isUsdcAuction &&
    parsedAmount != null &&
    parsedAmount > 0n &&
    (usdcAllowance == null || usdcAllowance < parsedAmount);

  const isSeller =
    Boolean(address) &&
    address!.toLowerCase() === auction.seller.toLowerCase();
  const isAgent =
    Boolean(address && auction.agent) &&
    address!.toLowerCase() === auction.agent!.toLowerCase();
  const isLeading =
    Boolean(address && auction.highestBidder) &&
    address!.toLowerCase() === auction.highestBidder!.toLowerCase();

  const wrongChain = walletChainId !== wagmiChainId(chainId);

  const minNext = minNextBid(auction.highestBid, minIncrementBps, auction.reserve);
  const minLabel = formatAuctionAmount(minNext, assetLabel);
  const placeholderSuffix = assetLabel === "USDC" ? " USDC" : " ETH";

  const disputed = uiState === "S4";
  const ended = uiState === "S5";
  const live =
    uiState === "S1" || uiState === "S3" || uiState === "S4";

  const disabledReason = (() => {
    if (!mode) return "Auctions are not available on this chain.";
    if (isUsdcAuction && !usdc)
      return "The settlement token for this lot is unavailable.";
    if (paused === true) return null;
    if (ended) return "This auction has ended. The page will update shortly.";
    if (isSeller || isAgent) return "Sellers and agents cannot bid on their own auction.";
    if (wrongChain) return "Switch to the correct network to bid.";
    if (!live) return "Bidding is not open.";
    return null;
  })();

  const insufficientBalance =
    parsedAmount != null &&
    parsedAmount > 0n &&
    (isUsdcAuction
      ? usdcBalance != null && usdcBalance < parsedAmount
      : ethBalance != null && ethBalance.value < parsedAmount);

  const bidDisabled =
    !isConnected ||
    paused === true ||
    Boolean(disabledReason) ||
    busy ||
    isWriting ||
    insufficientBalance;

  const mapBidError = (err: unknown): string => {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("BidTooLow")) {
      return formatBidTooLowMessage(minLabel, minIncrementBps);
    }
    return txErrorMessage(err);
  };

  async function onBid() {
    await runFlow(async () => {
      setTxError(null);
      if (!mode || !address) return;

      const amount = parseOwnerMinAsset(amountStr, assetLabel);
      if (amount == null) {
        setTxError(
          `Bid at least ${minLabel} — enter a valid ${assetLabel} amount.`,
        );
        return;
      }

      if (amount < minNext) {
        setTxError(formatBidTooLowMessage(minLabel, minIncrementBps));
        return;
      }

      if (isUsdcAuction) {
        if (!usdc) {
          setTxError("The settlement token for this lot is unavailable.");
          return;
        }
        if (usdcBalance != null && usdcBalance < amount) {
          setTxError("Insufficient USDC balance for this bid.");
          return;
        }
      } else if (ethBalance && ethBalance.value < amount) {
        setTxError("Insufficient ETH balance for this bid.");
        return;
      }

      try {
        if (isUsdcAuction && usdc) {
          const allowance = usdcAllowance ?? 0n;
          if (allowance < amount) {
            const approveHash = await writeContractAsync({
              address: usdc,
              abi: ERC20_ABI,
              functionName: "approve",
              args: [mode, amount],
              chainId: wagmiChainId(chainId),
            });
            await awaitReceipt(approveHash, { mapError: mapBidError });
            await refetchUsdcAllowance();
            await refetchUsdcBalance();
          }
        }

        const succeeded = await runTx(
          () =>
            writeContractAsync({
              address: mode,
              abi: AscendingConsignmentAbi,
              functionName: "bid",
              args: [BigInt(tokenId), amount],
              value: isUsdcAuction ? 0n : amount,
              chainId: wagmiChainId(chainId),
            }),
          { mapError: mapBidError },
        );
        if (succeeded) {
          setAmountStr("");
        }
      } catch (err) {
        setTxError(mapBidError(err));
      }
    });
  }

  if (!isConnected) {
    return (
      <div className="space-y-3 rounded-md border border-border-default bg-bg-surface p-4">
        <p className="font-sans text-sm text-text-secondary">
          Connect your wallet to place a bid.
        </p>
        <WalletLoginButton />
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-md border border-border-default bg-bg-surface p-4">
      {paused === true ? <CommercePausedNotice mode="ascending" /> : null}

      {isLeading && (
        <p className="font-sans text-sm font-medium text-text-primary">
          You are the highest bidder.
        </p>
      )}

      {disputed && (
        <p className="font-sans text-sm text-status-error" role="status">
          This passport is disputed. Bidding continues; after finalize, delivery
          issues use the settlement hold.
        </p>
      )}

      {uiState === "S1" && (
        <p className="font-sans text-sm text-text-secondary">
          {ASCENDING_S1_HELP}
        </p>
      )}

      {(() => {
        const protectionLabel = formatWindowDurationLabel(
          protectionWindowSec ?? undefined,
        );
        if (!protectionLabel) return null;
        return (
          <p className="font-sans text-sm text-text-secondary" role="note">
            If you win, payment stays in a {protectionLabel} protection hold
            after finalize so you can receive the vehicle and open a settlement
            challenge if needed.
          </p>
        );
      })()}

      <div className="space-y-2">
        <label
          htmlFor="auction-bid-amount"
          className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-text-tertiary"
        >
          Bid amount ({assetLabel})
        </label>
        <input
          id="auction-bid-amount"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder={minLabel.replace(placeholderSuffix, "")}
          value={amountStr}
          onChange={(e) => setAmountStr(e.target.value)}
          disabled={bidDisabled}
          className={cn(
            "w-full min-h-11 rounded-sm border border-border-default bg-bg-primary px-3",
            "font-mono text-sm tabular-nums text-text-primary",
            "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
            "disabled:opacity-50",
          )}
        />
        <p className="font-sans text-xs text-text-secondary">
          Minimum{" "}
          <span className="font-mono tabular-nums text-text-primary">
            {minLabel}
          </span>
        </p>
        {insufficientBalance && (
          <p className="font-sans text-sm text-status-error" role="alert">
            Insufficient {assetLabel} balance for this bid.
          </p>
        )}
      </div>

      {disabledReason && (
        <p className="font-sans text-sm text-text-secondary">{disabledReason}</p>
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
        disabled={bidDisabled || !amountStr.trim()}
        onClick={() => void onBid()}
      >
        {phase === "indexing" || busy || isWriting
          ? "Confirming…"
          : needsUsdcApproval
            ? "Approve USDC and place bid"
            : "Place bid"}
      </Button>

      <div className="space-y-2 border-t border-border-default pt-3">
        <p className="font-sans text-xs text-text-secondary">{ASCENDING_BID_HELD}</p>
        <div className="min-h-[2.5rem]" aria-live="polite" aria-atomic="true">
          {extensionFlash ? (
            <p className="font-sans text-xs text-text-secondary">{extensionFlash}</p>
          ) : formatExtensionHelp(extensionWindow) != null ? (
            <p className="font-sans text-xs text-text-secondary">
              {formatExtensionHelp(extensionWindow)}
            </p>
          ) : null}
        </div>
        {mode && (
          <p className="font-sans text-xs text-text-secondary">
            Ascending consignment contract{" "}
            <EnsWalletLink
              address={mode}
              className="font-mono text-xs text-text-secondary"
            />
          </p>
        )}
      </div>
    </div>
  );
}
