"use client";

import { useCallback, useMemo, useState } from "react";
import { waitForTransactionReceipt } from "wagmi/actions";
import {
  useChainId,
  useConfig,
  useSwitchChain,
  useWriteContract,
} from "wagmi";

import { ReturnCooldownDisplay, useReturnRemainingSeconds } from "@/components/marketplace/return-cooldown-display";
import { Button } from "@/components/ui/button";
import { MarketplaceEscrowAbi } from "@/lib/contracts/abis.generated";
import {
  effectiveReturnRequestedAt,
  parseReturnRequestedAt,
} from "@/lib/marketplace/listing-agent";
import { txErrorMessage } from "@/lib/marketplace/tx-error-message";
import { marketplaceAddress } from "@/lib/web3/deployment-addresses";
import { wagmiChainId } from "@/lib/web3/supported-chains";

type Props = {
  chainId: number;
  tokenId: string;
  ponderReturnRequestedAt?: string | number;
  chainReturnRequestedAt?: bigint;
  agentAuthActive: boolean;
  onChanged: () => void;
};

export function OwnerReturnRequestPanel({
  chainId,
  tokenId,
  ponderReturnRequestedAt,
  chainReturnRequestedAt,
  agentAuthActive,
  onChanged,
}: Props) {
  const config = useConfig();
  const wc = wagmiChainId(chainId);
  const walletChain = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync, isPending } = useWriteContract();

  const market = marketplaceAddress(chainId);
  const tid = BigInt(tokenId);
  const wrongChain = walletChain !== chainId;

  const [txError, setTxError] = useState<string | null>(null);

  const returnAt = useMemo(
    () =>
      effectiveReturnRequestedAt(
        parseReturnRequestedAt(ponderReturnRequestedAt),
        chainReturnRequestedAt,
      ),
    [ponderReturnRequestedAt, chainReturnRequestedAt],
  );

  const remaining = useReturnRemainingSeconds(returnAt);
  const cooldownActive = returnAt > 0n && remaining > 0n;
  const cooldownElapsed = returnAt > 0n && remaining <= 0n;
  const noRequestYet = returnAt === 0n;

  const runRequestReturn = useCallback(async () => {
    if (!market || !noRequestYet) return;
    if (wrongChain) await switchChainAsync?.({ chainId: wc });
    setTxError(null);
    try {
      const hash = await writeContractAsync({
        address: market,
        abi: MarketplaceEscrowAbi,
        functionName: "requestReturn",
        args: [tid],
      });
      await waitForTransactionReceipt(config, { hash });
      onChanged();
    } catch (err) {
      setTxError(txErrorMessage(err));
    }
  }, [
    market,
    noRequestYet,
    wrongChain,
    switchChainAsync,
    wc,
    writeContractAsync,
    tid,
    config,
    onChanged,
  ]);

  const runForceReturn = useCallback(async () => {
    if (!market || !cooldownElapsed || !agentAuthActive) return;
    if (wrongChain) await switchChainAsync?.({ chainId: wc });
    setTxError(null);
    try {
      const hash = await writeContractAsync({
        address: market,
        abi: MarketplaceEscrowAbi,
        functionName: "forceReturn",
        args: [tid],
      });
      await waitForTransactionReceipt(config, { hash });
      onChanged();
    } catch (err) {
      setTxError(txErrorMessage(err));
    }
  }, [
    market,
    cooldownElapsed,
    agentAuthActive,
    wrongChain,
    switchChainAsync,
    wc,
    writeContractAsync,
    tid,
    config,
    onChanged,
  ]);

  return (
    <div className="space-y-4 rounded-md border border-border-default bg-bg-surface p-4">
      <div>
        <p className="font-sans text-xs font-medium uppercase tracking-[0.12em] text-text-tertiary">
          Return from agent
        </p>
        <p className="mt-2 text-sm text-text-secondary">
          Your KarPro can list and price this vehicle without further approval. If they are
          unresponsive, you can request the vehicle back. After 7 days you may force the return
          on-chain.
        </p>
      </div>

      {noRequestYet && (
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          disabled={isPending}
          onClick={() => void runRequestReturn()}
        >
          Request return
        </Button>
      )}

      {(cooldownActive || cooldownElapsed) && (
        <ReturnCooldownDisplay returnRequestedAt={returnAt} />
      )}

      {(cooldownActive || cooldownElapsed) && (
        <div className="space-y-2">
          <Button
            type="button"
            variant="outline"
            className="w-full border-status-error text-status-error hover:bg-bg-surface"
            disabled={isPending || cooldownActive || !agentAuthActive}
            onClick={() => void runForceReturn()}
          >
            Force return
          </Button>
          {cooldownActive && (
            <p className="text-center text-xs text-text-secondary">
              Available after countdown ends
            </p>
          )}
          {!agentAuthActive && cooldownElapsed && (
            <p className="text-center text-xs text-text-secondary">
              Authorization is no longer active on-chain
            </p>
          )}
          {cooldownActive && (
            <p className="text-xs text-text-secondary">
              Your agent can still return the vehicle immediately from their consignment
              dashboard. If they do, this section will disappear when the listing ends.
            </p>
          )}
        </div>
      )}

      {txError && (
        <p className="text-sm text-status-error" role="alert">
          {txError}
        </p>
      )}
    </div>
  );
}
