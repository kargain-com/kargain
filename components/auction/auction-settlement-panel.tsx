"use client";

import { useActiveAccount, requireEvmSession, evmSwitchChainAvailability } from "@/hooks/use-active-account";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { WalletLoginButton } from "@/components/wallet-login-button";
import { usePassportApproval } from "@/hooks/use-passport-approval";
import { TX_SYNC_LAG_ADVISORY, useTxSync } from "@/hooks/use-tx-sync";
import { auctionTerminalMessage } from "@/lib/auction/auction-terminal-copy";
import {
  endsAtDateTimeAttr,
  formatAuctionAmount,
  formatAuctionCountdownSeconds,
} from "@/lib/auction/format-auction";
import type { AuctionRow } from "@/lib/auction/map-ponder-auction";
import {
  JUDGE_OUTCOME,
  SETTLEMENT_INSTANCE,
  deriveChallengeSurface,
  isAvailable,
  settlementWithdrawDisclosure,
  type ChallengeSnapshot,
} from "@/lib/challenge";
import { addressesMatch } from "@/lib/commerce/consignment";
import { commerceModeAddress } from "@/lib/commerce/mode";
import type { AscendingHoldSnapshot } from "@/lib/commerce/parse-ascending";
import {
  REVERSAL_ABANDONMENT_CONSEQUENCE,
  REVERSAL_NOT_HOLDER_COPY,
  REVERSAL_PENDING_BUYER_BODY,
  REVERSAL_REFUND_CLAIMS_DISCLOSURE,
  RELEASE_FUNDS_CONSEQUENCE,
  ascendingSettlementCopy,
  deriveAscendingSettlementActions,
  deriveAscendingSettlementState,
  isCompleteReversalActionable,
} from "@/lib/commerce/settlement-state";
import {
  AscendingConsignmentAbi,
  KarProStakingAbi,
} from "@/lib/contracts/abis.generated";
import {
  commerceConfirmedLabel,
  commerceConfirmedPanel,
} from "@/lib/design/instrument-classes";
import { txErrorMessage } from "@/lib/marketplace/tx-error-message";
import { useKeyedReadContracts } from "@/lib/web3/keyed-multicall";
import {
  commercialActive,
  nativeUnitOf,
} from "@/lib/web3/commercial-active";
import { karProStakingAddress } from "@/lib/web3/deployment-addresses";
import { wagmiChainId } from "@/lib/web3/supported-chains";
import { cn } from "@/lib/utils";
import { useEvmWriteContract } from "@/lib/web3/evm-write-adapter";

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
  /** Live `ownerOf` — `undefined` unread, `null` failed. */
  passportTokenOwner: string | null | undefined;
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
  passportTokenOwner,
  auctionUiState,
}: Props) {
  const { account, switchChain } = useActiveAccount();
  const evm = requireEvmSession(account);
  const address = evm.ok ? evm.address : undefined;
  const isConnected = evm.ok;
  const walletChainId = evm.ok ? evm.chainId : undefined;
  const switchAvail = evmSwitchChainAvailability(account);

        const { writeContractAsync, isPending: isWriting } = useEvmWriteContract();
  const { runTx, awaitReceipt, busy, error, syncLagged } = useTxSync(chainId);
  const [txError, setTxError] = useState<string | null>(null);

  const mode = commerceModeAddress("ascending", chainId);
  const wrongChain = walletChainId !== wagmiChainId(chainId);
  const tid = BigInt(tokenId);
  const staking = karProStakingAddress(chainId);
  const wc = wagmiChainId(chainId);

  const verifierReads = useKeyedReadContracts({
    contracts:
      address && staking
        ? [
            {
              key: "isActiveVerifier" as const,
              address: staking,
              abi: KarProStakingAbi,
              functionName: "isActiveVerifier",
              args: [address],
              chainId: wc,
            },
          ]
        : [],
  });
  const verifierEntry = verifierReads.entry("isActiveVerifier");
  const isActiveVerifier: boolean | undefined =
    verifierEntry?.status === "success"
      ? verifierEntry.result === true
      : address
        ? undefined
        : false;

  const state = deriveAscendingSettlementState({ hold, challenge, nowSec: now });

  const {
    isApproved: modeApproved,
    step: approvalStep,
    ensureApproved,
  } = usePassportApproval({
    chainId,
    tokenId,
    spender: mode,
    enabled: Boolean(
      isConnected &&
        mode &&
        (state === "REVERSAL_PENDING" || state === "REVERSAL_EXPIRED"),
    ),
  });

  const actions = deriveAscendingSettlementActions({
    state,
    hold,
    viewer: address,
    seller: auction.seller,
    agent: auction.agent,
    passportOwner: passportTokenOwner,
    modeApproved,
  });
  const challengeSurface = deriveChallengeSurface(SETTLEMENT_INSTANCE, {
    challenge,
    wallet: address,
    isActiveVerifier,
    buyer: hold?.buyer,
    seller: auction.seller,
    agent: auction.agent,
    subjectChallengeable: state === "HOLD",
    nowSec: now,
  });

  const isBuyer =
    Boolean(address && hold && addressesMatch(hold.buyer, address));
  const nativeUnit = nativeUnitOf(commercialActive(chainId)!);
  const grossLabel = hold
    ? formatAuctionAmount(hold.gross, auction.assetLabel, nativeUnit)
    : null;
  const bondLabel =
    challengeBond != null
      ? formatAuctionAmount(challengeBond, "ETH", nativeUnit)
      : null;
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
      if (wrongChain) {
        if (!switchAvail.available) throw new Error(`switchChain unavailable: ${switchAvail.cause}`);
        await switchChain(chainId);
      }
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

  async function onCompleteReversal() {
    if (!mode) return;
    setTxError(null);
    try {
      if (wrongChain) {
        if (!switchAvail.available) throw new Error(`switchChain unavailable: ${switchAvail.cause}`);
        await switchChain(chainId);
      }
      await runTx(async () => {
        await ensureApproved(awaitReceipt);
        return writeContractAsync({
          address: mode,
          abi: AscendingConsignmentAbi,
          functionName: "completeReversal",
          args: [tid],
          chainId: wagmiChainId(chainId),
        });
      });
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
      if (wrongChain) {
        if (!switchAvail.available) throw new Error(`switchChain unavailable: ${switchAvail.cause}`);
        await switchChain(chainId);
      }
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
      if (wrongChain) {
        if (!switchAvail.available) throw new Error(`switchChain unavailable: ${switchAvail.cause}`);
        await switchChain(chainId);
      }
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
      ? formatAuctionAmount(fees.gross, auction.assetLabel, nativeUnit)
      : (grossLabel ?? "—");
    const net = fees
      ? formatAuctionAmount(fees.net, auction.assetLabel, nativeUnit)
      : "—";
    const agentFee = fees
      ? formatAuctionAmount(fees.agentFee, auction.assetLabel, nativeUnit)
      : "—";
    const platformFee = fees
      ? formatAuctionAmount(fees.platformFee, auction.assetLabel, nativeUnit)
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
  const challengeEndsAt =
    challengeSurface.windowEndsAt > 0 ? challengeSurface.windowEndsAt : null;

  const abandonment =
    hold.abandonmentDeadline > 0
      ? formatHoldDate(hold.abandonmentDeadline)
      : null;
  const abandonmentCountdown =
    hold.abandonmentDeadline > 0
      ? formatAuctionCountdownSeconds(BigInt(hold.abandonmentDeadline), now)
      : null;
  const abandonmentAttr =
    hold.abandonmentDeadline > 0
      ? endsAtDateTimeAttr(BigInt(hold.abandonmentDeadline))
      : null;

  const completeBlockedNotHolder =
    actions.completeReversal.status === "blocked" &&
    actions.completeReversal.cause === "not_holder";
  const showCompleteCta = isCompleteReversalActionable(actions.completeReversal);

  return (
    <div className="space-y-4 rounded-md border border-border-default bg-bg-surface p-4">
      {state === "REVERSAL_PENDING" && isBuyer ? (
        <div className="space-y-2">
          <p className="font-sans text-sm text-text-primary">
            {REVERSAL_PENDING_BUYER_BODY}
          </p>
          <p className="font-sans text-xs text-text-secondary">
            {REVERSAL_REFUND_CLAIMS_DISCLOSURE}
          </p>
        </div>
      ) : (
        <p className="font-sans text-sm text-text-primary">
          {ascendingSettlementCopy(state)}
        </p>
      )}

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

      {(state === "REVERSAL_PENDING" || state === "REVERSAL_EXPIRED") &&
        abandonment &&
        abandonmentAttr &&
        abandonmentCountdown != null && (
          <div className="space-y-1">
            <p className="font-sans text-xs text-text-secondary">
              {state === "REVERSAL_PENDING" ? (
                <>
                  Return by{" "}
                  <time
                    dateTime={abandonment.dateTime}
                    className="font-mono tabular-nums text-text-primary"
                  >
                    {abandonment.label}
                  </time>{" "}
                  (
                  <time
                    dateTime={abandonmentAttr}
                    className="font-mono tabular-nums text-text-primary"
                  >
                    {abandonmentCountdown}
                  </time>{" "}
                  left). {REVERSAL_ABANDONMENT_CONSEQUENCE}
                </>
              ) : (
                <>
                  Abandonment deadline{" "}
                  <time
                    dateTime={abandonment.dateTime}
                    className="font-mono tabular-nums text-text-primary"
                  >
                    {abandonment.label}
                  </time>{" "}
                  has passed. Anyone can abandon the reversal and the seller is
                  paid as though the challenge had failed.
                </>
              )}
            </p>
          </div>
        )}

      {state === "REVERSAL_PENDING" &&
        isBuyer &&
        completeBlockedNotHolder && (
          <p className="font-sans text-sm text-text-secondary" role="status">
            {REVERSAL_NOT_HOLDER_COPY}
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

          {actions.confirmReceipt.status === "available" && (
            <Button
              type="button"
              className="w-full"
              disabled={actionBusy || !mode}
              onClick={() => void run("confirmReceipt")}
            >
              {actionBusy ? "Confirming…" : "Confirm receipt"}
            </Button>
          )}

          {actions.releaseFunds.status === "available" && (
            <div className="space-y-2">
              <p className="font-sans text-xs text-text-secondary">
                {RELEASE_FUNDS_CONSEQUENCE}
              </p>
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                disabled={actionBusy || !mode}
                onClick={() => void run("releaseFunds")}
              >
                {actionBusy ? "Confirming…" : "Release payment"}
              </Button>
            </div>
          )}

          {showCompleteCta && (
            <Button
              type="button"
              className="w-full"
              disabled={actionBusy || !mode}
              onClick={() => void onCompleteReversal()}
            >
              {actionBusy
                ? approvalStep === "approving" || modeApproved !== true
                  ? "Approving passport…"
                  : "Confirming…"
                : "Return passport and refund"}
            </Button>
          )}

          {actions.abandonReversal.status === "available" && (
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

          {isAvailable(challengeSurface.open) && (
            <div className="space-y-2 border-t border-border-default pt-3">
              <p className="font-sans text-xs text-text-secondary">
                {challengeSurface.openDisclosure}
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

          {isAvailable(challengeSurface.withdraw) && (
            <div className="space-y-2 border-t border-border-default pt-3">
              <p className="font-sans text-xs text-text-secondary">
                {settlementWithdrawDisclosure(hold?.frozenRemaining)}
              </p>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={actionBusy || !mode}
                onClick={() => void run("withdraw")}
              >
                {actionBusy ? "Confirming…" : "Withdraw challenge"}
              </Button>
            </div>
          )}

          {isAvailable(challengeSurface.conclude) && (
            <div className="space-y-2 border-t border-border-default pt-3">
              <p className="font-sans text-xs text-text-secondary">
                {challengeSurface.terminals.expired.concludeCopy}
              </p>
              <Button
                type="button"
                className="w-full"
                disabled={actionBusy || !mode}
                onClick={() => void run("conclude")}
              >
                {actionBusy ? "Confirming…" : "Conclude challenge"}
              </Button>
            </div>
          )}

          {isAvailable(challengeSurface.judge) && (
            <div className="space-y-3 border-t border-border-default pt-3">
              <p className="font-sans text-sm text-text-secondary">
                Judge this challenge as an independent active KarPro. You are not
                the buyer, seller, agent, or challenger.
              </p>
              <div className="space-y-2">
                <p className="font-sans text-xs text-text-secondary">
                  {challengeSurface.terminals.upheld.judgeCopy}
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
                  {challengeSurface.terminals.rejected.judgeCopy}
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

          {challengeSurface.exclusionCopy &&
            challenge &&
            !isAvailable(challengeSurface.judge) &&
            challengeSurface.phase === "active" && (
              <p className="font-sans text-xs text-text-secondary">
                {challengeSurface.exclusionCopy}
              </p>
            )}
        </>
      )}
    </div>
  );
}
