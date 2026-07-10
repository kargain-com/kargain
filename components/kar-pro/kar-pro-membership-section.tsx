"use client";

import { useState } from "react";
import { waitForTransactionReceipt } from "wagmi/actions";
import {
  useChainId,
  useConfig,
  useSwitchChain,
  useWriteContract,
} from "wagmi";

import { Button } from "@/components/ui/button";
import { KarProStakingAbi } from "@/lib/contracts/abis.generated";
import { monoLinkSm } from "@/lib/design/instrument-classes";
import { useMinStakeNative } from "@/hooks/use-min-stake-native";
import { formatKarProPassTitle, proPassTokenIdFromAddress } from "@/lib/kar-pro/pro-pass-token-id";
import { karProStakingAddress } from "@/lib/web3/deployment-addresses";
import { DEFAULT_CHAIN_ID, wagmiChainId } from "@/lib/web3/supported-chains";
import { explorerAddressUrl } from "@/lib/web3/wallet-account";

type KarProMembershipSectionProps = {
  passId?: bigint;
  address: `0x${string}`;
  onLeft?: () => void;
};

export function KarProMembershipSection({
  passId,
  address,
  onLeft,
}: KarProMembershipSectionProps) {
  const chainId = DEFAULT_CHAIN_ID;
  const config = useConfig();
  const walletChain = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const { stakeLabel } = useMinStakeNative();

  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const staking = karProStakingAddress(chainId);
  const wc = wagmiChainId(chainId);
  const wrongChain = walletChain !== chainId;
  const resolvedPassId = passId ?? proPassTokenIdFromAddress(address);

  const onLeave = async () => {
    if (!staking) return;
    setError(null);
    setLoading(true);

    try {
      if (wrongChain) await switchChainAsync?.({ chainId: wc });

      const hash = await writeContractAsync({
        address: staking,
        abi: KarProStakingAbi,
        functionName: "leave",
      });

      await waitForTransactionReceipt(config, { hash });
      setLeaveConfirm(false);
      onLeft?.();
    } catch (err) {
      if (err instanceof Error && err.message.includes("User rejected")) {
        setError("Transaction cancelled.");
      } else {
        setError(err instanceof Error ? err.message : "Leave failed. Try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-md border border-border-default bg-bg-card p-6 md:p-8">
      <div className="space-y-3">
        <p className="font-mono text-fluid-sm tabular-nums text-text-primary">
          {stakeLabel} ETH staked
        </p>
        <p className="font-mono text-fluid-sm text-text-secondary">
          {formatKarProPassTitle(resolvedPassId, chainId, { showChain: false })}
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
              {formatKarProPassTitle(resolvedPassId, chainId, { showChain: false })}. Continue?
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="ghost"
                className="text-status-error hover:bg-bg-surface hover:text-status-error"
                disabled={loading}
                onClick={() => void onLeave()}
              >
                Confirm leave
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={loading}
                onClick={() => {
                  setLeaveConfirm(false);
                  setError(null);
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

      {error && (
        <p role="alert" className="mt-4 font-sans text-fluid-sm text-status-error">
          {error}
        </p>
      )}
    </div>
  );
}
