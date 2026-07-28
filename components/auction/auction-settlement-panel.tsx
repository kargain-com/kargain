"use client";

import { useState } from "react";
import {
  useAccount,
  useChainId,
  useReadContract,
  useSwitchChain,
  useWriteContract,
} from "wagmi";

import { Button } from "@/components/ui/button";
import { WalletLoginButton } from "@/components/wallet-login-button";
import { TX_SYNC_LAG_ADVISORY, useTxSync } from "@/hooks/use-tx-sync";
import {
  endsAtDateTimeAttr,
  formatAuctionAmount,
  formatAuctionCountdownSeconds,
} from "@/lib/auction/format-auction";
import { auctionTerminalMessage } from "@/lib/auction/auction-terminal-copy";
import type { AuctionRow } from "@/lib/auction/map-ponder-auction";
import type { OnChainHold } from "@/lib/auction/parse-on-chain-auction";
import {
  deriveSettlementUiState,
  mergeSettlementSnapshot,
  type SettlementUiState,
} from "@/lib/auction/settlement-state";
import {
  AuctionEscrowAbi,
  KarPassportAbi,
  KarProStakingAbi,
} from "@/lib/contracts/abis.generated";
import {
  commerceConfirmedLabel,
  commerceConfirmedPanel,
} from "@/lib/design/instrument-classes";
import { txErrorMessage } from "@/lib/marketplace/tx-error-message";
import {
  auctionEscrowAddress,
  karPassportAddress,
  karProStakingAddress,
} from "@/lib/web3/deployment-addresses";
import { wagmiChainId } from "@/lib/web3/supported-chains";
import { cn } from "@/lib/utils";

type Props = {
  chainId: number;
  tokenId: string;
  auction: AuctionRow;
  hold: OnChainHold | null;
  /** Unix seconds from useNow. */
  now: number;
  settlementDisputeBond: bigint | undefined;
  settlementHold: bigint | undefined;
  disputeResolutionTimeout: bigint;
  /** Auction island UI state — S8/S9 terminal readouts. */
  auctionUiState: "SETTLED" | "S8" | "S9";
};

function formatHoldDate(sec: bigint): { label: string; dateTime: string } {
  const date = new Date(Number(sec) * 1000);
  return {
    label: date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }),
    dateTime: date.toISOString(),
  };
}

function sameAddress(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

export function AuctionSettlementPanel({
  chainId,
  tokenId,
  auction,
  hold,
  now,
  settlementDisputeBond,
  settlementHold,
  disputeResolutionTimeout,
  auctionUiState,
}: Props) {
  const { address, isConnected } = useAccount();
  const walletChainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync, isPending: isWriting } = useWriteContract();
  const { runTx, awaitReceipt, runFlow, busy, error, syncLagged } =
    useTxSync(chainId);
  const [txError, setTxError] = useState<string | null>(null);

  const escrow = auctionEscrowAddress(chainId);
  const passport = karPassportAddress(chainId);
  const staking = karProStakingAddress(chainId);
  const wrongChain = walletChainId !== wagmiChainId(chainId);

  const snap = mergeSettlementSnapshot(auction.settlement, hold);
  const settlementState: SettlementUiState =
    auctionUiState === "S8"
      ? "RELEASED"
      : auctionUiState === "S9"
        ? "NONE"
        : deriveSettlementUiState({
            settlement: auction.settlement,
            hold,
            nowSec: now,
            disputeResolutionTimeoutSec: disputeResolutionTimeout,
          });

  const { data: isActiveVerifier } = useReadContract({
    address: staking,
    abi: KarProStakingAbi,
    functionName: "isActiveVerifier",
    args: address ? [address] : undefined,
    chainId: wagmiChainId(chainId),
    query: {
      enabled: Boolean(
        staking && address && settlementState === "DISPUTED",
      ),
    },
  });

  const { data: approvedForAll, refetch: refetchApproval } = useReadContract({
    address: passport,
    abi: KarPassportAbi,
    functionName: "isApprovedForAll",
    args: address && escrow ? [address, escrow] : undefined,
    chainId: wagmiChainId(chainId),
    query: {
      enabled: Boolean(
        address &&
          passport &&
          escrow &&
          settlementState === "REFUND_PENDING",
      ),
    },
  });

  const isBuyer = sameAddress(address, snap?.buyer);
  const isSeller = sameAddress(address, auction.seller);
  const isAgent = sameAddress(address, auction.agent);
  const isParty = isBuyer || isSeller || isAgent;
  const canResolve =
    isActiveVerifier === true && !isParty && isConnected;

  const bond =
    settlementDisputeBond ??
    (snap?.bond && snap.bond > 0n ? snap.bond : undefined);
  const bondLabel = bond != null ? formatAuctionAmount(bond, "ETH") : null;
  const grossLabel = snap
    ? formatAuctionAmount(snap.gross, auction.assetLabel)
    : null;

  const holdSec = settlementHold ?? 7n * 24n * 60n * 60n;
  const abandonedEligibleAt =
    snap && snap.refundPendingAt > 0n
      ? snap.refundPendingAt + holdSec
      : 0n;
  const sellerCanClaimAbandoned =
    isSeller &&
    settlementState === "REFUND_PENDING" &&
    abandonedEligibleAt > 0n &&
    BigInt(now) >= abandonedEligibleAt;

  async function ensureChain() {
    if (wrongChain) {
      await switchChainAsync({ chainId: wagmiChainId(chainId) });
    }
  }

  async function onConfirmReceipt() {
    if (!escrow) return;
    setTxError(null);
    await runTx(() =>
      writeContractAsync({
        address: escrow,
        abi: AuctionEscrowAbi,
        functionName: "confirmReceipt",
        args: [BigInt(tokenId)],
        chainId: wagmiChainId(chainId),
      }),
    );
  }

  async function onOpenDispute() {
    if (!escrow || bond == null) {
      setTxError("Dispute bond is still loading. Try again shortly.");
      return;
    }
    setTxError(null);
    await runTx(() =>
      writeContractAsync({
        address: escrow,
        abi: AuctionEscrowAbi,
        functionName: "openSettlementDispute",
        args: [BigInt(tokenId)],
        value: bond,
        chainId: wagmiChainId(chainId),
      }),
    );
  }

  async function onReleaseFunds() {
    if (!escrow) return;
    setTxError(null);
    await runTx(() =>
      writeContractAsync({
        address: escrow,
        abi: AuctionEscrowAbi,
        functionName: "releaseFunds",
        args: [BigInt(tokenId)],
        chainId: wagmiChainId(chainId),
      }),
    );
  }

  async function onResolve(outcome: 0 | 1) {
    if (!escrow) return;
    setTxError(null);
    await runTx(() =>
      writeContractAsync({
        address: escrow,
        abi: AuctionEscrowAbi,
        functionName: "resolveSettlementDispute",
        args: [BigInt(tokenId), outcome],
        chainId: wagmiChainId(chainId),
      }),
    );
  }

  async function onReturnAndRefund() {
    await runFlow(async () => {
      if (!escrow || !passport || !address) return;
      setTxError(null);
      try {
        if (!approvedForAll) {
          await ensureChain();
          const approveHash = await writeContractAsync({
            address: passport,
            abi: KarPassportAbi,
            functionName: "setApprovalForAll",
            args: [escrow, true],
            chainId: wagmiChainId(chainId),
          });
          await awaitReceipt(approveHash);
          await refetchApproval();
          return;
        }
        await runTx(() =>
          writeContractAsync({
            address: escrow,
            abi: AuctionEscrowAbi,
            functionName: "returnPassportAndRefund",
            args: [BigInt(tokenId)],
            chainId: wagmiChainId(chainId),
          }),
        );
      } catch (err) {
        setTxError(txErrorMessage(err));
      }
    });
  }

  async function onClaimAbandoned() {
    if (!escrow) return;
    setTxError(null);
    await runTx(() =>
      writeContractAsync({
        address: escrow,
        abi: AuctionEscrowAbi,
        functionName: "claimAbandonedRefund",
        args: [BigInt(tokenId)],
        chainId: wagmiChainId(chainId),
      }),
    );
  }

  const actionBusy = busy || isWriting;

  // —— S9 cancelled / returned ——
  if (auctionUiState === "S9") {
    return (
      <div
        className="space-y-3 rounded-md border border-border-default bg-bg-surface p-4"
        role="status"
      >
        <p className="font-sans text-sm text-text-secondary">
          {auctionTerminalMessage(auction.phase)}
        </p>
      </div>
    );
  }

  // —— S8 / RELEASED ——
  if (settlementState === "RELEASED" || auctionUiState === "S8") {
    const fees = auction.settlement;
    const gross = fees
      ? formatAuctionAmount(fees.gross, auction.assetLabel)
      : grossLabel ?? "—";
    const net = fees
      ? formatAuctionAmount(fees.net, auction.assetLabel)
      : "—";
    const agentFee = fees
      ? formatAuctionAmount(fees.agentFee, auction.assetLabel)
      : "—";
    const platformFee = fees
      ? formatAuctionAmount(fees.platformFee, auction.assetLabel)
      : "—";

    return (
      <div className={cn(commerceConfirmedPanel, "space-y-3")} role="status">
        <p className={cn("font-sans text-sm", commerceConfirmedLabel)}>
          Sale complete.{" "}
          <span className="font-mono tabular-nums">{gross}</span> split: seller{" "}
          <span className="font-mono tabular-nums">{net}</span> · agent{" "}
          <span className="font-mono tabular-nums">{agentFee}</span> · platform{" "}
          <span className="font-mono tabular-nums">{platformFee}</span>.
        </p>
        <p className="font-sans text-sm text-text-secondary">
          Vehicle re-registration happens off-chain. Keep the passport records
          updated after handover.
        </p>
      </div>
    );
  }

  if (settlementState === "CLEARED" || settlementState === "NONE" || !snap) {
    return null;
  }

  const releaseDate = formatHoldDate(snap.releaseAt);
  const releaseCountdown = formatAuctionCountdownSeconds(snap.releaseAt, now);
  const releaseAttr = endsAtDateTimeAttr(snap.releaseAt);

  // —— HOLD_RELEASABLE / DISPUTE_TIMED_OUT — permissionless release ——
  if (
    settlementState === "HOLD_RELEASABLE" ||
    settlementState === "DISPUTE_TIMED_OUT"
  ) {
    return (
      <div className="space-y-4 rounded-md border border-border-default bg-bg-surface p-4">
        <p className="font-sans text-sm text-text-primary">
          {settlementState === "DISPUTE_TIMED_OUT"
            ? "The settlement dispute timed out without a resolution. Anyone can release payment to the seller."
            : "The protection hold has ended. Anyone can release payment to the seller."}
        </p>
        {grossLabel && (
          <p className="font-mono text-sm tabular-nums text-text-primary">
            Held {grossLabel}
          </p>
        )}
        {!isConnected ? (
          <WalletLoginButton />
        ) : (
          <>
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
              disabled={actionBusy || !escrow}
              onClick={() => void onReleaseFunds()}
            >
              {actionBusy ? "Confirming…" : "Release payment"}
            </Button>
          </>
        )}
      </div>
    );
  }

  // —— DISPUTED ——
  if (settlementState === "DISPUTED") {
    const autoReleaseAt = snap.disputedAt + disputeResolutionTimeout;
    const autoDate = formatHoldDate(autoReleaseAt);
    return (
      <div className="space-y-4 rounded-md border border-border-default bg-bg-surface p-4">
        <div
          className="rounded-md border border-status-error/40 bg-bg-primary p-3"
          role="status"
        >
          <p className="font-sans text-sm text-status-error">Payout frozen</p>
          <p className="mt-1 font-sans text-sm text-text-secondary">
            If unresolved, payment auto-releases to the seller on{" "}
            <time
              dateTime={autoDate.dateTime}
              className="font-mono tabular-nums text-text-primary"
            >
              {autoDate.label}
            </time>
            .
          </p>
        </div>
        {grossLabel && (
          <p className="font-mono text-sm tabular-nums text-text-primary">
            Held {grossLabel}
          </p>
        )}

        {canResolve && (
          <div className="space-y-3 border-t border-border-default pt-3">
            <p className="font-sans text-sm text-text-secondary">
              Resolve as an active KarPro. You are not a party to this sale.
            </p>
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
            <div className="space-y-2">
              <p className="font-sans text-xs text-text-secondary">
                Release to seller pays out the held sale and sends the dispute
                bond to you. Use only when delivery succeeded.
              </p>
              <Button
                type="button"
                className="w-full"
                disabled={actionBusy || !escrow}
                onClick={() => void onResolve(0)}
              >
                {actionBusy ? "Confirming…" : "Release to seller"}
              </Button>
            </div>
            <div className="space-y-2">
              <p className="font-sans text-xs text-status-error">
                Confirm failure freezes a refund path: the buyer must return the
                passport to recover the sale amount plus bond. Irreversible
                without buyer cooperation or the abandoned-refund timeout.
              </p>
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                disabled={actionBusy || !escrow}
                onClick={() => void onResolve(1)}
              >
                {actionBusy ? "Confirming…" : "Confirm failure"}
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // —— REFUND_PENDING ——
  if (settlementState === "REFUND_PENDING") {
    const bondPart = formatAuctionAmount(snap.bond, "ETH");
    const grossPart = formatAuctionAmount(snap.gross, auction.assetLabel);
    return (
      <div className="space-y-4 rounded-md border border-border-default bg-bg-surface p-4">
        <p className="font-sans text-sm text-text-primary">
          Sale marked as failed. Refund pending.
        </p>
        <p className="font-sans text-sm text-text-secondary">
          Buyer refund is{" "}
          <span className="font-mono tabular-nums text-text-primary">
            {grossPart}
          </span>{" "}
          plus bond{" "}
          <span className="font-mono tabular-nums text-text-primary">
            {bondPart}
          </span>{" "}
          after the passport returns to the seller.
        </p>

        {isBuyer && isConnected && (
          <>
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
              disabled={actionBusy || !escrow || !passport}
              onClick={() => void onReturnAndRefund()}
            >
              {actionBusy
                ? "Confirming…"
                : !approvedForAll
                  ? "Approve passport"
                  : "Return passport and refund"}
            </Button>
          </>
        )}

        {isSeller && isConnected && (
          <>
            {!sellerCanClaimAbandoned && abandonedEligibleAt > 0n && (
              <p className="font-sans text-sm text-text-secondary">
                If the buyer does not return the passport, you can claim payment
                after{" "}
                <time
                  dateTime={formatHoldDate(abandonedEligibleAt).dateTime}
                  className="font-mono tabular-nums text-text-primary"
                >
                  {formatHoldDate(abandonedEligibleAt).label}
                </time>
                . Keeping the vehicle keeps the deal — the buyer keeps the
                passport and you receive the held sale proceeds.
              </p>
            )}
            {sellerCanClaimAbandoned && (
              <>
                <p className="font-sans text-sm text-text-secondary">
                  Keeping the vehicle keeps the deal. Claim abandoned payment to
                  receive the held proceeds while the buyer keeps the passport.
                </p>
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
                  disabled={actionBusy || !escrow}
                  onClick={() => void onClaimAbandoned()}
                >
                  {actionBusy ? "Confirming…" : "Claim abandoned refund"}
                </Button>
              </>
            )}
          </>
        )}

        {!isBuyer && !isSeller && (
          <p className="font-sans text-sm text-text-secondary">
            Waiting for the buyer to return the passport for a full refund, or
            for the seller abandoned-refund window.
          </p>
        )}
      </div>
    );
  }

  // —— HOLD (S6) ——
  if (settlementState === "HOLD") {
    return (
      <div className="space-y-4 rounded-md border border-border-default bg-bg-surface p-4">
        {isBuyer ? (
          <>
            <p className="font-sans text-sm text-text-primary">
              <span className="font-mono tabular-nums">{grossLabel}</span> is
              held for your protection until{" "}
              <time
                dateTime={releaseDate.dateTime}
                className="font-mono tabular-nums"
              >
                {releaseDate.label}
              </time>
              . Confirm receipt to release payment early, or open a dispute if
              the vehicle was not delivered as sold.
            </p>
            {releaseAttr && (
              <p className="font-sans text-xs text-text-secondary">
                Releases in{" "}
                <time
                  dateTime={releaseAttr}
                  className="font-mono tabular-nums text-text-primary"
                >
                  {releaseCountdown}
                </time>
              </p>
            )}
            {!isConnected ? (
              <WalletLoginButton />
            ) : (
              <>
                {(txError ?? error) && (
                  <p
                    className="font-sans text-sm text-status-error"
                    role="alert"
                  >
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
                  disabled={actionBusy || !escrow}
                  onClick={() => void onConfirmReceipt()}
                >
                  {actionBusy ? "Confirming…" : "Confirm receipt"}
                </Button>
                <div className="space-y-2 border-t border-border-default pt-3">
                  <p className="font-sans text-xs text-text-secondary">
                    Opening a dispute locks a{" "}
                    <span className="font-mono tabular-nums text-text-primary">
                      {bondLabel ?? "…"}
                    </span>{" "}
                    bond, even for USDC auctions. You get it back if the dispute
                    is confirmed.
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full"
                    disabled={actionBusy || !escrow || bond == null}
                    onClick={() => void onOpenDispute()}
                  >
                    {actionBusy
                      ? "Confirming…"
                      : bondLabel
                        ? `Open dispute (${bondLabel})`
                        : "Open dispute"}
                  </Button>
                </div>
              </>
            )}
          </>
        ) : (
          <p className="font-sans text-sm text-text-secondary">
            Payment is released when the buyer confirms receipt, or
            automatically on{" "}
            <time
              dateTime={releaseDate.dateTime}
              className="font-mono tabular-nums text-text-primary"
            >
              {releaseDate.label}
            </time>
            .
          </p>
        )}
      </div>
    );
  }

  return null;
}
