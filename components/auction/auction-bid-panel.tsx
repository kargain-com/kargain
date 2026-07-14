"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  useAccount,
  useBalance,
  useChainId,
  useReadContract,
  useSwitchChain,
  useWriteContract,
  useConfig,
} from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";

import { Button } from "@/components/ui/button";
import { EnsWalletLink } from "@/components/ui/ens-wallet-link";
import { WalletLoginButton } from "@/components/wallet-login-button";
import { minNextBid } from "@/lib/auction/auction-bid-math";
import { formatAuctionAmount } from "@/lib/auction/format-auction";
import type { AuctionRow, AuctionUiState } from "@/lib/auction/map-ponder-auction";
import { parseOwnerMinAsset } from "@/lib/auction/owner-min-asset";
import { AuctionEscrowAbi } from "@/lib/contracts/abis.generated";
import {
  formatBidTooLowMessage,
  formatPassportBidBlockedMessage,
  txErrorMessage,
} from "@/lib/marketplace/tx-error-message";
import {
  auctionEscrowAddress,
  usdcAddress,
} from "@/lib/web3/deployment-addresses";
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
  paused: boolean;
  onSuccess?: () => void;
};

export function AuctionBidPanel({
  chainId,
  tokenId,
  auction,
  uiState,
  minIncrementBps,
  paused,
  onSuccess,
}: Props) {
  const router = useRouter();
  const config = useConfig();
  const { address, isConnected } = useAccount();
  const walletChainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync, isPending: isWriting } = useWriteContract();

  const [amountStr, setAmountStr] = useState("");
  const [txError, setTxError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const escrow = auctionEscrowAddress(chainId);
  const usdc = usdcAddress(chainId);
  const isUsdcAuction = auction.assetLabel === "USDC";
  const assetLabel = auction.assetLabel;

  const { data: ethBalance } = useBalance({
    address,
    chainId: wagmiChainId(chainId),
    query: { enabled: Boolean(address && escrow && !isUsdcAuction) },
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
    args: address && escrow ? [address, escrow] : undefined,
    chainId: wagmiChainId(chainId),
    query: { enabled: Boolean(address && usdc && escrow && isUsdcAuction) },
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
    if (!escrow) return "Auctions are not available on this chain.";
    if (isUsdcAuction && !usdc) return "USDC is not configured on this chain.";
    if (paused) return "Auctions are temporarily paused. Existing refunds and payouts are unaffected.";
    if (ended) return "This auction has ended. The page will update shortly.";
    if (disputed) return null; // S4 panel shown separately
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
    Boolean(disabledReason) ||
    disputed ||
    busy ||
    isWriting ||
    insufficientBalance;

  async function onBid() {
    setTxError(null);
    if (!escrow || !address) return;

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
        setTxError("USDC is not configured on this chain.");
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

    setBusy(true);
    try {
      if (wrongChain) {
        await switchChainAsync({ chainId: wagmiChainId(chainId) });
      }

      if (isUsdcAuction && usdc) {
        const allowance = usdcAllowance ?? 0n;
        if (allowance < amount) {
          const approveHash = await writeContractAsync({
            address: usdc,
            abi: ERC20_ABI,
            functionName: "approve",
            args: [escrow, amount],
            chainId: wagmiChainId(chainId),
          });
          await waitForTransactionReceipt(config, { hash: approveHash });
          await refetchUsdcAllowance();
          await refetchUsdcBalance();
          return;
        }

        const hash = await writeContractAsync({
          address: escrow,
          abi: AuctionEscrowAbi,
          functionName: "bid",
          args: [BigInt(tokenId), amount],
          value: 0n,
          chainId: wagmiChainId(chainId),
        });
        await waitForTransactionReceipt(config, { hash });
      } else {
        const hash = await writeContractAsync({
          address: escrow,
          abi: AuctionEscrowAbi,
          functionName: "bid",
          args: [BigInt(tokenId), amount],
          value: amount,
          chainId: wagmiChainId(chainId),
        });
        await waitForTransactionReceipt(config, { hash });
      }

      setAmountStr("");
      onSuccess?.();
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("BidTooLow")) {
        setTxError(formatBidTooLowMessage(minLabel, minIncrementBps));
      } else if (msg.includes("PassportNotVerified")) {
        setTxError(formatPassportBidBlockedMessage("unverified"));
      } else if (msg.includes("PassportDisputed")) {
        setTxError(formatPassportBidBlockedMessage("disputed"));
      } else {
        setTxError(txErrorMessage(err));
      }
    } finally {
      setBusy(false);
    }
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
      {isLeading && (
        <p className="font-sans text-sm font-medium text-text-primary">
          You are the highest bidder.
        </p>
      )}

      {disputed && (
        <div
          className="rounded-md border border-status-error/40 bg-bg-primary p-3 text-sm text-status-error"
          role="status"
        >
          Bidding is paused while this passport is disputed. If the dispute is
          rejected the auction resumes; if confirmed, the auction is voided and
          every bid is refunded.
        </div>
      )}

      {uiState === "S1" && (
        <p className="font-sans text-sm text-text-secondary">
          The auction starts when someone bids at least the reserve. Until then
          the seller can cancel.
        </p>
      )}

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

      {txError && (
        <p className="font-sans text-sm text-status-error" role="alert">
          {txError}
        </p>
      )}

      <Button
        type="button"
        className="w-full"
        disabled={bidDisabled || !amountStr.trim()}
        onClick={() => void onBid()}
      >
        {busy || isWriting
          ? "Confirming…"
          : needsUsdcApproval
            ? "Approve USDC"
            : "Place bid"}
      </Button>

      <div className="space-y-2 border-t border-border-default pt-3">
        <p className="font-sans text-xs text-text-secondary">
          Your full bid is held by the auction contract until you are outbid or
          you win. Outbid funds return automatically.
        </p>
        <p className="font-sans text-xs text-text-secondary">
          Bids in the last 5 minutes extend the auction by 5 minutes.
        </p>
        {escrow && (
          <p className="font-sans text-xs text-text-secondary">
            Escrow contract{" "}
            <EnsWalletLink
              address={escrow}
              className="font-mono text-xs text-text-secondary"
            />
          </p>
        )}
      </div>
    </div>
  );
}
