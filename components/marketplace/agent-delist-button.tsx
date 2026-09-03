"use client";

import { useActiveAccount, requireEvmSession, evmSwitchChainAvailability } from "@/hooks/use-active-account";

import { useCallback, useState } from "react";

import { EvmSessionRefusal } from "@/components/shell/evm-session-refusal";
import { Button } from "@/components/ui/button";
import { TX_SYNC_LAG_ADVISORY, useTxSync } from "@/hooks/use-tx-sync";
import { commerceModeAddress } from "@/lib/commerce/mode";
import { FixedPriceConsignmentAbi } from "@/lib/contracts/abis.generated";
import { txErrorMessage } from "@/lib/marketplace/tx-error-message";
import { wagmiChainId } from "@/lib/web3/supported-chains";
import { useEvmWriteContract } from "@/lib/web3/evm-write-adapter";

type Props = {
  chainId: number;
  tokenId: string;
  wallet: `0x${string}`;
  /** Optional local UI hook (collapse panels). Indexer refresh is owned by `useTxSync`. */
  onSuccess?: () => void;
};

export function AgentDelistButton({ chainId, tokenId, wallet, onSuccess }: Props) {
  const { account, switchChain } = useActiveAccount();
  const evm = requireEvmSession(account);
  const address = evm.ok ? evm.address : undefined;
  const walletChain = evm.ok ? evm.chainId : undefined;
  const switchAvail = evmSwitchChainAvailability(account);

  const wc = wagmiChainId(chainId);
        const { writeContractAsync, isPending } = useEvmWriteContract();
  const { runTx, phase, error, syncLagged } = useTxSync(chainId);
  const busy = isPending || phase !== "idle";

  const market = commerceModeAddress("fixedPrice", chainId);
  const tid = BigInt(tokenId);
  const wrongChain = evm.ok && walletChain !== chainId;

  const [txError, setTxError] = useState<string | null>(null);

  const isAgentWallet = address?.toLowerCase() === wallet.toLowerCase();

  const runAgentDelist = useCallback(async () => {
    if (!market || !isAgentWallet) return;
    if (wrongChain) {
        if (!switchAvail.available) throw new Error(`switchChain unavailable: ${switchAvail.cause}`);
        await switchChain(wc );
      }
    setTxError(null);
    try {
      const succeeded = await runTx(() =>
        writeContractAsync({
          address: market,
          abi: FixedPriceConsignmentAbi,
          functionName: "agentWithdraw",
          args: [tid],
        }),
      );
      if (!succeeded) return;
      onSuccess?.();
    } catch (err) {
      setTxError(txErrorMessage(err));
    }
  }, [
    market,
    isAgentWallet,
    wrongChain,
    switchChain,
    wc,
    writeContractAsync,
    tid,
    onSuccess,
    runTx, switchAvail]);

  return (
    <div className="mt-3 border-t border-border-default pt-3">
      {(txError ?? error) && (
        <p className="mb-2 text-sm text-status-error" role="alert">
          {txError ?? error}
        </p>
      )}
      {syncLagged && (
        <p role="status" className="font-sans text-xs text-text-tertiary">
          {TX_SYNC_LAG_ADVISORY}
        </p>
      )}
      {!evm.ok ? (
        <EvmSessionRefusal
          cause={evm.cause}
          disconnectedTitle="Connect the agent wallet to return this vehicle to the owner."
          className="mb-2 space-y-2"
        />
      ) : !isAgentWallet ? (
        <p className="mb-2 text-xs text-text-secondary">
          Connect the agent wallet to return this vehicle to the owner.
        </p>
      ) : null}
      <Button
        type="button"
        variant="outline"
        className="w-full border-status-error text-status-error hover:bg-bg-surface"
        disabled={busy || !isAgentWallet}
        onClick={() => void runAgentDelist()}
      >
        {busy ? "Confirming…" : "Return to owner"}
      </Button>
    </div>
  );
}
