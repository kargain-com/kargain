"use client";

import { useState } from "react";
import { useWriteContract } from "wagmi";

import { Button } from "@/components/ui/button";
import { useMinStakeNative } from "@/hooks/use-min-stake-native";
import { TX_SYNC_LAG_ADVISORY, useTxSync } from "@/hooks/use-tx-sync";
import { KarProStakingAbi } from "@/lib/contracts/abis.generated";
import { monoLinkSm } from "@/lib/design/instrument-classes";
import { formatKarProPassTitle, proPassTokenIdFromAddress } from "@/lib/kar-pro/pro-pass-token-id";
import { karProStakingAddress } from "@/lib/web3/deployment-addresses";
import { wagmiChainId } from "@/lib/web3/supported-chains";
import { explorerAddressUrl } from "@/lib/web3/wallet-account";

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
  const { writeContractAsync } = useWriteContract();
  const { runTx, phase: txPhase, error: txSyncError, syncLagged } = useTxSync(chainId);
  const { stakeLabel } = useMinStakeNative(chainId);
  const wc = wagmiChainId(chainId);

  const [leaveConfirm, setLeaveConfirm] = useState(false);

  const staking = karProStakingAddress(chainId);
  const resolvedPassId = passId ?? proPassTokenIdFromAddress(address);
  const loading = txPhase !== "idle";

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
            : err instanceof Error
              ? err.message
              : "Leave failed. Try again.",
      },
    );
    if (succeeded) {
      setLeaveConfirm(false);
      onLeft?.();
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
          Fully refundable · No slash · Leave anytime
        </p>
        {staking && (
          <p className="font-sans text-fluid-sm text-text-secondary">
            <a
              href={explorerAddressUrl(chainId, staking)}
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
        <p className="font-sans text-fluid-sm text-text-secondary">
          Leave KarPro — your stake ({stakeLabel} ETH) will be returned. Your verification history
          remains on-chain permanently.
        </p>

        {leaveConfirm ? (
          <div className="space-y-3 rounded-md border border-border-default bg-bg-surface p-4">
            <p className="font-sans text-sm text-text-primary">
              This will burn your{" "}
              {formatKarProPassTitle(resolvedPassId, chainId, { showChain: true })}. Continue?
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
            disabled={loading}
            onClick={() => setLeaveConfirm(true)}
          >
            Leave KarPro
          </Button>
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
