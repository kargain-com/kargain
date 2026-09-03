"use client";

import { useActiveAccount, requireEvmSession, evmSwitchChainAvailability } from "@/hooks/use-active-account";

import Link from "next/link";
import { useCallback, useState } from "react";

import { IdentityAvatar } from "@/components/identity/identity-avatar";
import { Button } from "@/components/ui/button";
import { usePeerIdentity } from "@/hooks/use-peer-identity";
import { TX_SYNC_LAG_ADVISORY, useTxSync } from "@/hooks/use-tx-sync";
import type { MandateSnapshot } from "@/lib/commerce/mandate";
import { commerceModeAddress } from "@/lib/commerce/mode";
import { FixedPriceConsignmentAbi } from "@/lib/contracts/abis.generated";
import { categoryLabel } from "@/lib/design/instrument-classes";
import { formatFiat1e8 } from "@/lib/marketplace/fiat-format";
import type { ListingCurrencyCode } from "@/lib/marketplace/currency-code";
import { txErrorMessage } from "@/lib/marketplace/tx-error-message";
import { wagmiChainId } from "@/lib/web3/supported-chains";
import { useEvmWriteContract } from "@/lib/web3/evm-write-adapter";

type Props = {
  chainId: number;
  tokenId: string;
  /** Fixed-price mandate read from the mode contract. */
  mandate: MandateSnapshot;
  /** A live consignment blocks revoke — recall it first. */
  listingActive: boolean;
  onChanged: () => void;
};

function formatExpiry(expiry: number): string {
  if (expiry === 0) return "No expiration";
  return new Date(expiry * 1000).toLocaleDateString();
}

/**
 * Pre-open fixed-price mandate card: agent identity, granted floor, revoke.
 * Live-consignment floor concessions live on the shared owner panel — not here
 * (the mode entry point requires a live consignment).
 */
export function AgentAuthorizationStatus({
  chainId,
  tokenId,
  mandate,
  listingActive,
  onChanged,
}: Props) {
  const { account, switchChain } = useActiveAccount();
  const evm = requireEvmSession(account);
  const walletChain = evm.ok ? evm.chainId : undefined;
  const switchAvail = evmSwitchChainAvailability(account);

  const wc = wagmiChainId(chainId);
      const { writeContractAsync, isPending } = useEvmWriteContract();
  const { runTx, phase, error, syncLagged } = useTxSync(chainId);
  const busy = isPending || phase !== "idle";

  const market = commerceModeAddress("fixedPrice", chainId);
  const tid = BigInt(tokenId);
  const wrongChain = walletChain !== chainId;

  const currencyCode: ListingCurrencyCode = "USD";
  const { displayName, isKarPro, profileHref } = usePeerIdentity(mandate.agent, {
    chainId,
  });

  const [txError, setTxError] = useState<string | null>(null);

  const runRevoke = useCallback(async () => {
    if (!market || listingActive) return;
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
          functionName: "revoke",
          args: [tid],
        }),
      );
      if (!succeeded) return;
      onChanged();
    } catch (err) {
      setTxError(txErrorMessage(err));
    }
  }, [
    market,
    listingActive,
    wrongChain,
    switchChain,
    wc,
    writeContractAsync,
    tid,
    onChanged,
    runTx, switchAvail]);

  return (
    <div className="space-y-4 rounded-md border border-border-default bg-bg-surface p-4">
      <div>
        <p className="font-sans text-xs font-medium uppercase tracking-[0.12em] text-text-tertiary">
          Delegated to
        </p>
        <div className="mt-2 flex items-center gap-3">
          <IdentityAvatar address={mandate.agent} size={40} alt={displayName} />
          <div className="min-w-0">
            <Link
              href={profileHref}
              className="truncate font-sans text-sm font-medium text-text-primary underline-offset-2 hover:text-accent-warm hover:underline"
            >
              {displayName}
            </Link>
            {isKarPro && (
              <p className={categoryLabel}>
                KarPro
              </p>
            )}
          </div>
        </div>
      </div>

      <dl className="space-y-2 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-text-secondary">
            Minimum you&apos;ll receive ({currencyCode})
          </dt>
          <dd className="font-mono tabular-nums text-text-primary">
            {formatFiat1e8(mandate.floor)} {currencyCode}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-text-secondary">Authorization</dt>
          <dd className="text-text-primary">{formatExpiry(mandate.expiry)}</dd>
        </div>
      </dl>

      {(txError ?? error) && (
        <p className="text-sm text-status-error" role="alert">
          {txError ?? error}
        </p>
      )}
      {syncLagged && (
        <p role="status" className="font-sans text-xs text-text-tertiary">
          {TX_SYNC_LAG_ADVISORY}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={listingActive || busy}
          onClick={() => void runRevoke()}
        >
          {busy ? "Confirming…" : "Revoke agent"}
        </Button>
        {listingActive && (
          <p className="text-center text-xs text-text-secondary">
            Return the vehicle from the agent before revoking access
          </p>
        )}
      </div>
    </div>
  );
}
