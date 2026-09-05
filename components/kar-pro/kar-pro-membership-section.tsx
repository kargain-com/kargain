"use client";

import { useState } from "react";
import Link from "next/link";
import { useReadContract } from "wagmi";

import { Button } from "@/components/ui/button";
import { useMinStakeNative } from "@/hooks/use-min-stake-native";
import { TX_SYNC_LAG_ADVISORY, useTxSync } from "@/hooks/use-tx-sync";
import { KarProStakingAbi } from "@/lib/contracts/abis.generated";
import { monoLinkSm, sansLink } from "@/lib/design/instrument-classes";
import { formatKarProPassTitle, proPassTokenIdFromAddress } from "@/lib/kar-pro/pro-pass-token-id";
import { karProLeaveNetworkScopeCopy } from "@/lib/kar-pro/membership-roster";
import { karProStakingAddress } from "@/lib/web3/deployment-addresses";
import { writeOutcomeHasClaimRecipient } from "@/lib/web3/write-outcome";
import { wagmiChainId } from "@/lib/web3/supported-chains";
import { requireCommercialActive } from "@/lib/web3/commercial-active";
import { explorerAddressUrl } from "@/lib/web3/network-explorer";
import { txErrorMessage } from "@/lib/marketplace/tx-error-message";
import { useEvmWriteContract } from "@/lib/web3/evm-write-adapter";

type KarProMembershipSectionProps = {
  chainId: number;
  passId?: bigint;
  address: `0x${string}`;
  onLeft?: () => void;
};

export function KarProMembershipSection({
  chainId,
  passId,
  address,
  onLeft,
}: KarProMembershipSectionProps) {
  const { writeContractAsync } = useEvmWriteContract();
  const { runTx, phase: txPhase, error: txSyncError, syncLagged } = useTxSync(chainId);
  const { stakeLabel } = useMinStakeNative(chainId);
  const wc = wagmiChainId(chainId);

  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const [claimMessage, setClaimMessage] = useState<string | null>(null);

  const staking = karProStakingAddress(chainId);
  const resolvedPassId = passId ?? proPassTokenIdFromAddress(address);
  const loading = txPhase !== "idle";

  const { data: stakeRow, refetch: refetchStake } = useReadContract({
    address: staking,
    abi: KarProStakingAbi,
    functionName: "stakes",
    args: [address],
    chainId: wc,
    query: { enabled: Boolean(staking && address) },
  });

  const stakeActive = stakeRow?.[3] === true;
  const unlockAt = stakeRow?.[4] ?? 0n;
  const unbonding = !stakeActive && unlockAt > 0n;
  const unlockReady =
    unbonding && typeof stakeRow !== "undefined"
      ? BigInt(Math.floor(Date.now() / 1000)) >= unlockAt
      : false;

  const onLeave = async () => {
    if (!staking) return;

    const succeeded = await runTx(
      () =>
        writeContractAsync({
          address: staking,
          abi: KarProStakingAbi,
          functionName: "leave",
          chainId: wc,
        }),
      {
        mapError: (err) =>
          err instanceof Error && err.message.includes("User rejected")
            ? "Transaction cancelled."
            : txErrorMessage(err),
      },
    );
    if (succeeded) {
      setLeaveConfirm(false);
      void refetchStake();
      onLeft?.();
    }
  };

  const onClaimStake = async () => {
    if (!staking) return;

    setClaimMessage(null);
    const succeeded = await runTx(
      () =>
        writeContractAsync({
          address: staking,
          abi: KarProStakingAbi,
          functionName: "claimStake",
          chainId: wc,
        }),
      {
        mapError: (err) =>
          err instanceof Error && err.message.includes("User rejected")
            ? "Transaction cancelled."
            : txErrorMessage(err),
      },
    );
    if (succeeded) {
      void refetchStake();
      if (writeOutcomeHasClaimRecipient(succeeded, address)) {
        setClaimMessage(
          "Your stake could not be delivered and is waiting under Claims.",
        );
      } else {
        setClaimMessage("Stake released to your wallet.");
      }
    }
  };

  return (
    <div className="rounded-md border border-border-default bg-bg-card p-6 md:p-8">
      <div className="space-y-3">
        <p className="font-mono text-fluid-sm tabular-nums text-text-primary">
          {stakeLabel} ETH staked
        </p>
        <p className="font-mono text-fluid-sm text-text-secondary">
          {formatKarProPassTitle(resolvedPassId, chainId, { showChain: true })}
        </p>
        <p className="font-sans text-fluid-sm text-text-secondary">
          {unbonding
            ? unlockReady
              ? "Unbonding complete · Claim your stake"
              : "Unbonding · Stake unlocks after 14 days"
            : "Refundable after leave · 14-day unbond · No slash"}
        </p>
        <p className="font-sans text-xs text-text-tertiary">
          {karProLeaveNetworkScopeCopy(chainId)}
        </p>
        {staking && (
          <p className="font-sans text-fluid-sm text-text-secondary">
            <a
              href={explorerAddressUrl(requireCommercialActive(chainId), staking)}
              target="_blank"
              rel="noopener noreferrer"
              className={monoLinkSm}
            >
              View staking contract
            </a>
          </p>
        )}
      </div>

      <div className="mt-6 space-y-3 border-t border-border-default pt-6">
        {unbonding ? (
          <>
            <p className="font-sans text-fluid-sm text-text-secondary">
              Your KarPro role ended when you left. After the unbonding period, claim your stake
              ({stakeLabel} ETH). Verification history remains on-chain permanently.
            </p>
            <Button
              type="button"
              variant="ghost"
              disabled={loading || !unlockReady}
              onClick={() => void onClaimStake()}
            >
              {txPhase === "indexing"
                ? "Confirming…"
                : unlockReady
                  ? "Claim stake"
                  : "Claim available after unbond"}
            </Button>
            {claimMessage ? (
              <p className="font-sans text-sm text-text-secondary" role="status">
                {claimMessage}{" "}
                {claimMessage.includes("Claims") ? (
                  <Link href={`/profile/${address}?tab=claims`} className={sansLink}>
                    View claims
                  </Link>
                ) : null}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <p className="font-sans text-fluid-sm text-text-secondary">
              Leave KarPro — your role ends immediately and your stake ({stakeLabel} ETH) unlocks
              after 14 days. Your verification history remains on-chain permanently.
            </p>

            {leaveConfirm ? (
              <div className="space-y-3 rounded-md border border-border-default bg-bg-surface p-4">
                <p className="font-sans text-sm text-text-primary">
                  This will burn your{" "}
                  {formatKarProPassTitle(resolvedPassId, chainId, { showChain: true })} and start a
                  14-day unbond. Continue?
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-status-error hover:bg-bg-surface hover:text-status-error"
                    disabled={loading}
                    onClick={() => void onLeave()}
                  >
                    {txPhase === "indexing" ? "Confirming…" : "Confirm leave"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={loading}
                    onClick={() => {
                      setLeaveConfirm(false);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                type="button"
                variant="ghost"
                className="text-status-error hover:bg-bg-surface hover:text-status-error"
                disabled={loading || !stakeActive}
                onClick={() => setLeaveConfirm(true)}
              >
                Leave KarPro
              </Button>
            )}
          </>
        )}
      </div>

      {txSyncError && (
        <p role="alert" className="mt-4 font-sans text-fluid-sm text-status-error">
          {txSyncError}
        </p>
      )}
      {syncLagged && (
        <p role="status" className="font-sans text-xs text-text-tertiary">
          {TX_SYNC_LAG_ADVISORY}
        </p>
      )}
    </div>
  );
}
