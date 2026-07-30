"use client";

import { useState } from "react";
import {
  useAccount,
  useChainId,
  useSwitchChain,
  useWriteContract,
} from "wagmi";

import { Button } from "@/components/ui/button";
import { WalletLoginButton } from "@/components/wallet-login-button";
import { TX_SYNC_LAG_ADVISORY, useTxSync } from "@/hooks/use-tx-sync";
import { auctionTerminalMessage } from "@/lib/auction/auction-terminal-copy";
import {
  endsAtDateTimeAttr,
  formatAuctionAmount,
  formatAuctionCountdownSeconds,
} from "@/lib/auction/format-auction";
import type { AuctionRow } from "@/lib/auction/map-ponder-auction";
import {
  deriveChallengeActions,
  challengeWindowEndsAt,
  JUDGE_OUTCOME,
  type ChallengeSnapshot,
} from "@/lib/commerce/challenge";
import { commerceModeAddress } from "@/lib/commerce/mode";
import type { AscendingHoldSnapshot } from "@/lib/commerce/parse-ascending";
import {
  ascendingSettlementCopy,
  deriveAscendingSettlementActions,
  deriveAscendingSettlementState,
} from "@/lib/commerce/settlement-state";
import { AscendingConsignmentAbi } from "@/lib/contracts/abis.generated";
import {
  commerceConfirmedLabel,
  commerceConfirmedPanel,
} from "@/lib/design/instrument-classes";
import { txErrorMessage } from "@/lib/marketplace/tx-error-message";
import { wagmiChainId } from "@/lib/web3/supported-chains";
import { cn } from "@/lib/utils";

type Props = {
  chainId: number;
  tokenId: string;
  auction: AuctionRow;
  hold: AscendingHoldSnapshot | null;
  challenge: ChallengeSnapshot | null;
  /** Unix seconds from useNow. */
  now: number;
  /** Bond required to open a challenge on this lot. */
  challengeBond: bigint | undefined;
  /** Auction island UI state — S8/S9 terminal readouts. */
  auctionUiState: "SETTLED" | "S8" | "S9";
};

function formatHoldDate(sec: number): { label: string; dateTime: string } {
  const date = new Date(sec * 1000);
  return {
    label: date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }),
    dateTime: date.toISOString(),
  };
}

export function AuctionSettlementPanel({
  chainId,
  tokenId,
  auction,
  hold,
  challenge,
  now,
  challengeBond,
  auctionUiState,
}: Props) {
  const { address, isConnected } = useAccount();
  const walletChainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync, isPending: isWriting } = useWriteContract();
  const { runTx, busy, error, syncLagged } = useTxSync(chainId);
  const [txError, setTxError] = useState<string | null>(null);

  const mode = commerceModeAddress("ascending", chainId);
  const wrongChain = walletChainId !== wagmiChainId(chainId);
  const tid = BigInt(tokenId);

  const state = deriveAscendingSettlementState({ hold, challenge, nowSec: now });
  const actions = deriveAscendingSettlementActions({
    state,
    hold,
    viewer: address,
    seller: auction.seller,
    agent: auction.agent,
  });
  const challengeActions = deriveChallengeActions({
    challenge,
    viewer: address,
    excludedJudges: [hold?.buyer, auction.seller, auction.agent],
    subjectChallengeable: state === "HOLD",
    nowSeconds: now,
  });

  const grossLabel = hold
    ? formatAuctionAmount(hold.gross, auction.assetLabel)
    : null;
  const bondLabel =
    challengeBond != null ? formatAuctionAmount(challengeBond, "ETH") : null;
  const actionBusy = busy || isWriting;

  async function run(
    functionName:
      | "confirmReceipt"
      | "releaseFunds"
      | "completeReversal"
      | "abandonReversal"
      | "conclude"
      | "withdraw",
  ) {
    if (!mode) return;
    setTxError(null);
    try {
      if (wrongChain) await switchChainAsync({ chainId: wagmiChainId(chainId) });
      await runTx(() =>
        writeContractAsync({
          address: mode,
          abi: AscendingConsignmentAbi,
          functionName,
          args: [tid],
          chainId: wagmiChainId(chainId),
        }),
      );
    } catch (err) {
      setTxError(txErrorMessage(err));
    }
  }

  async function onOpenChallenge() {
    if (!mode || challengeBond == null) {
      setTxError("Challenge bond is still loading. Try again shortly.");
      return;
    }
    setTxError(null);
    try {
      if (wrongChain) await switchChainAsync({ chainId: wagmiChainId(chainId) });
      await runTx(() =>
        writeContractAsync({
          address: mode,
          abi: AscendingConsignmentAbi,
          functionName: "open",
          args: [tid],
          value: challengeBond,
          chainId: wagmiChainId(chainId),
        }),
      );
    } catch (err) {
      setTxError(txErrorMessage(err));
    }
  }

  async function onJudge(outcome: 0 | 1) {
    if (!mode) return;
    setTxError(null);
    try {
      if (wrongChain) await switchChainAsync({ chainId: wagmiChainId(chainId) });
      await runTx(() =>
        writeContractAsync({
          address: mode,
          abi: AscendingConsignmentAbi,
          functionName: "judge",
          args: [tid, outcome],
          chainId: wagmiChainId(chainId),
        }),
      );
    } catch (err) {
      setTxError(txErrorMessage(err));
    }
  }

  const feedback = (
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
    </>
  );

  // —— S9 withdrawn / recalled ——
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

  // —— S8 released ——
  if (auctionUiState === "S8") {
    const fees = auction.settlement;
    const gross = fees
      ? formatAuctionAmount(fees.gross, auction.assetLabel)
      : (grossLabel ?? "—");
    const net = fees ? formatAuctionAmount(fees.net, auction.assetLabel) : "—";
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
          Payouts that could not reach a wallet wait under Claims. Vehicle
          re-registration happens off-chain — keep passport records updated
          after handover.
        </p>
      </div>
    );
  }

  if (state === "NONE" || !hold) return null;

  const protection = formatHoldDate(hold.protectionEndsAt);
  const protectionCountdown = formatAuctionCountdownSeconds(
    BigInt(hold.protectionEndsAt),
    now,
  );
  const protectionAttr = endsAtDateTimeAttr(BigInt(hold.protectionEndsAt));
  const challengeEndsAt = challengeWindowEndsAt(challenge);

  return (
    <div className="space-y-4 rounded-md border border-border-default bg-bg-surface p-4">
      <p className="font-sans text-sm text-text-primary">
        {ascendingSettlementCopy(state)}
      </p>

      {grossLabel && (
        <p className="font-mono text-sm tabular-nums text-text-primary">
          Held {grossLabel}
        </p>
      )}

      {state === "HOLD" && protectionAttr && (
        <p className="font-sans text-xs text-text-secondary">
          Releases in{" "}
          <time
            dateTime={protectionAttr}
            className="font-mono tabular-nums text-text-primary"
          >
            {protectionCountdown}
          </time>{" "}
          ·{" "}
          <time
            dateTime={protection.dateTime}
            className="font-mono tabular-nums text-text-primary"
          >
            {protection.label}
          </time>
        </p>
      )}

      {challenge && challengeEndsAt != null && (
        <p className="font-sans text-xs text-status-error">
          Challenge window ends{" "}
          <time
            dateTime={formatHoldDate(challengeEndsAt).dateTime}
            className="font-mono tabular-nums"
          >
            {formatHoldDate(challengeEndsAt).label}
          </time>
        </p>
      )}

      {!isConnected ? (
        <WalletLoginButton />
      ) : (
        <>
          {feedback}

          {actions.canConfirmReceipt && (
            <Button
              type="button"
              className="w-full"
              disabled={actionBusy || !mode}
              onClick={() => void run("confirmReceipt")}
            >
              {actionBusy ? "Confirming…" : "Confirm receipt"}
            </Button>
          )}

          {actions.canReleaseFunds && (
            <Button
              type="button"
              className="w-full"
              disabled={actionBusy || !mode}
              onClick={() => void run("releaseFunds")}
            >
              {actionBusy ? "Confirming…" : "Release payment"}
            </Button>
          )}

          {actions.canCompleteReversal && (
            <Button
              type="button"
              className="w-full"
              disabled={actionBusy || !mode}
              onClick={() => void run("completeReversal")}
            >
              {actionBusy ? "Confirming…" : "Return passport and refund"}
            </Button>
          )}

          {actions.canAbandonReversal && (
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              disabled={actionBusy || !mode}
              onClick={() => void run("abandonReversal")}
            >
              {actionBusy ? "Confirming…" : "Abandon reversal"}
            </Button>
          )}

          {challengeActions.canOpen && (
            <div className="space-y-2 border-t border-border-default pt-3">
              <p className="font-sans text-xs text-text-secondary">
                Opening a challenge locks a{" "}
                <span className="font-mono tabular-nums text-text-primary">
                  {bondLabel ?? "…"}
                </span>{" "}
                bond and freezes the protection clock. You get it back if the
                challenge is upheld.
              </p>
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                disabled={actionBusy || !mode || challengeBond == null}
                onClick={() => void onOpenChallenge()}
              >
                {actionBusy
                  ? "Confirming…"
                  : bondLabel
                    ? `Open challenge (${bondLabel})`
                    : "Open challenge"}
              </Button>
            </div>
          )}

          {challengeActions.canWithdraw && (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={actionBusy || !mode}
              onClick={() => void run("withdraw")}
            >
              {actionBusy ? "Confirming…" : "Withdraw challenge"}
            </Button>
          )}

          {challengeActions.canConclude && (
            <Button
              type="button"
              className="w-full"
              disabled={actionBusy || !mode}
              onClick={() => void run("conclude")}
            >
              {actionBusy ? "Confirming…" : "Conclude challenge"}
            </Button>
          )}

          {challengeActions.canJudge && (
            <div className="space-y-3 border-t border-border-default pt-3">
              <p className="font-sans text-sm text-text-secondary">
                Judge this challenge as an independent party. You are not the
                buyer, seller, agent, or challenger.
              </p>
              <div className="space-y-2">
                <p className="font-sans text-xs text-text-secondary">
                  Upholding the challenge starts a reversal: the buyer returns
                  the passport to recover the sale amount plus bond.
                </p>
                <Button
                  type="button"
                  className="w-full"
                  disabled={actionBusy || !mode}
                  onClick={() => void onJudge(JUDGE_OUTCOME.Upheld)}
                >
                  {actionBusy ? "Confirming…" : "Uphold challenge"}
                </Button>
              </div>
              <div className="space-y-2">
                <p className="font-sans text-xs text-text-secondary">
                  Rejecting the challenge resumes the protection clock and
                  forfeits the challenger&apos;s bond.
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full"
                  disabled={actionBusy || !mode}
                  onClick={() => void onJudge(JUDGE_OUTCOME.Rejected)}
                >
                  {actionBusy ? "Confirming…" : "Reject challenge"}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
