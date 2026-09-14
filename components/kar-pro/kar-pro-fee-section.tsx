"use client";

import { useEffect, useMemo, useState } from "react";
import { useReadContract } from "wagmi";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TxWriteRefusal } from "@/components/shell/tx-write-refusal";
import { TX_SYNC_LAG_ADVISORY, useTxSync } from "@/hooks/use-tx-sync";
import { useActiveAccount } from "@/hooks/use-active-account";
import { useSetVerificationFee } from "@/hooks/use-set-verification-fee";
import { useVerifyGasEstimate } from "@/hooks/use-verify-gas-estimate";
import { useMarketRatesRequest } from "@/hooks/use-market-rates-request";
import { categoryLabel } from "@/lib/design/instrument-classes";
import { KarProStakingAbi } from "@/lib/contracts/abis.generated";
import { useDisplayCurrency } from "@/lib/marketplace/display-currency-context";
import { fiatCurrencyOptionLabel } from "@/lib/marketplace/fiat-format";
import { pickPartialFxRates } from "@/lib/marketplace/fx-rate-registry";
import { useMarketRates } from "@/lib/marketplace/use-market-rates";
import {
  canComposeFeeInDisplayCurrency,
  deriveMarginWeiFromOnChain,
  displayAmountToFeeWei,
  formatFeeWeiEth,
  formatFeeWeiInDisplayCurrency,
} from "@/lib/verifier/fee-composer-math";
import { parseSvmFeeMarginNative } from "@/lib/verifier/verification-fee-composition";
import { verificationFeeSurface } from "@/lib/verifier/verification-fee-surface";
import { formatNativeAmountLabeled } from "@/lib/web3/native-amount";
import { wagmiChainId } from "@/lib/web3/supported-chains";
import { txWriteAvailability } from "@/lib/web3/tx-write-availability";

type KarProFeeSectionProps = {
  /** Commercial target namespace / EIP-155 id — not a program address. */
  chainId: number;
};

function displayCurrencyLabel(currency: string): string {
  if (currency === "ETH" || currency === "BTC") return currency;
  return fiatCurrencyOptionLabel(currency as Parameters<typeof fiatCurrencyOptionLabel>[0]);
}

export function KarProFeeSection({ chainId }: KarProFeeSectionProps) {
  const { account } = useActiveAccount();
  const writeAvail = txWriteAvailability(account, chainId);
  const surface = verificationFeeSurface(chainId);
  const { setVerificationFee } = useSetVerificationFee();
  const { runTx, phase: txPhase, error: txSyncError, syncLagged } = useTxSync(chainId);

  const includesExecutionCost =
    surface.configured && surface.includesExecutionCost;
  const feeReadable =
    surface.configured && surface.currentFee.status === "readable"
      ? surface.currentFee
      : null;
  const feeUnread =
    surface.configured && surface.currentFee.status === "unread"
      ? surface.currentFee
      : null;
  const marginNative =
    surface.configured && surface.marginEntry.input === "native"
      ? surface.marginEntry
      : null;
  const marginDisplayFx =
    surface.configured && surface.marginEntry.input === "display_fx";

  const { displayCurrency, isRatesLoading, ...rateFields } = useDisplayCurrency();
  const rates = useMemo(() => pickPartialFxRates(rateFields), [rateFields]);

  useMarketRatesRequest(includesExecutionCost);
  useMarketRates({ enabled: includesExecutionCost });
  const { costWei: gasCostWei, isLoading: gasLoading } = useVerifyGasEstimate({
    chainId,
    enabled: includesExecutionCost,
  });

  const verifierAddress =
    feeReadable && account.status === "connected"
      ? (account.address as `0x${string}`)
      : undefined;

  const staking = feeReadable?.stakingAddress;
  const wc = feeReadable ? wagmiChainId(chainId) : undefined;

  const { data: onChainFee } = useReadContract({
    address: staking,
    abi: KarProStakingAbi,
    functionName: "verificationFee",
    args: verifierAddress ? [verifierAddress] : undefined,
    chainId: wc,
    query: { enabled: Boolean(feeReadable && staking && verifierAddress) },
  });

  const ratesReady = includesExecutionCost
    ? canComposeFeeInDisplayCurrency(displayCurrency, rates)
    : true;

  const [marginInput, setMarginInput] = useState("");
  const [marginInitialized, setMarginInitialized] = useState(false);
  const [feeSaved, setFeeSaved] = useState(false);
  const [feeError, setFeeError] = useState<string | null>(null);
  const feeSaving = txPhase !== "idle";

  useEffect(() => {
    if (!feeReadable) return;
    if (marginInitialized || onChainFee === undefined) return;

    const marginWei = deriveMarginWeiFromOnChain(onChainFee, gasCostWei);
    const formatted = formatFeeWeiInDisplayCurrency(marginWei, displayCurrency, rates);
    setMarginInput(
      formatted ??
        (onChainFee > 0n ? formatFeeWeiEth(onChainFee).replace(/ ETH$/, "") : ""),
    );
    setMarginInitialized(true);
  }, [
    feeReadable,
    marginInitialized,
    onChainFee,
    gasCostWei,
    displayCurrency,
    rates,
  ]);

  const marginWei = useMemo(() => {
    if (!marginDisplayFx) return null;
    return displayAmountToFeeWei(marginInput, displayCurrency, rates);
  }, [marginDisplayFx, marginInput, displayCurrency, rates]);

  const marginLamports = useMemo(() => {
    if (marginNative == null) return null;
    return parseSvmFeeMarginNative(marginInput, marginNative.unit);
  }, [marginNative, marginInput]);

  const totalWei = useMemo(() => {
    if (!includesExecutionCost || marginWei == null) return null;
    return marginWei <= 0n ? 0n : marginWei + (gasCostWei ?? 0n);
  }, [includesExecutionCost, marginWei, gasCostWei]);

  const totalLamports = useMemo(() => {
    if (marginNative == null || marginLamports == null) return null;
    return marginLamports <= 0n ? 0n : marginLamports;
  }, [marginNative, marginLamports]);

  const marginDisplay =
    marginDisplayFx && marginWei != null
      ? formatFeeWeiInDisplayCurrency(marginWei, displayCurrency, rates)
      : marginNative != null && marginLamports != null
        ? formatNativeAmountLabeled(marginLamports, marginNative.unit)
        : null;
  const gasDisplay =
    includesExecutionCost && gasCostWei != null
      ? formatFeeWeiInDisplayCurrency(gasCostWei, displayCurrency, rates)
      : null;
  const totalDisplay =
    includesExecutionCost && totalWei != null
      ? formatFeeWeiInDisplayCurrency(totalWei, displayCurrency, rates)
      : marginNative != null && totalLamports != null
        ? formatNativeAmountLabeled(totalLamports, marginNative.unit)
        : null;

  const onSaveFee = async () => {
    if (!writeAvail.available || !surface.configured) return;

    if (includesExecutionCost) {
      if (!ratesReady) {
        setFeeError("Exchange rates unavailable. Try again in a moment.");
        return;
      }
      if (marginWei == null || totalWei == null) {
        setFeeError(
          `Enter a valid amount in ${displayCurrencyLabel(displayCurrency)}.`,
        );
        return;
      }
      setFeeError(null);
      setFeeSaved(false);
      const succeeded = await runTx(() =>
        setVerificationFee({
          chainId,
          marginNative: marginWei,
          gasWei: gasCostWei,
        }),
      );
      if (succeeded) setFeeSaved(true);
      return;
    }

    if (marginNative != null) {
      if (marginLamports == null || totalLamports == null) {
        setFeeError(`Enter a valid amount in ${marginNative.unit.symbol}.`);
        return;
      }
      setFeeError(null);
      setFeeSaved(false);
      const succeeded = await runTx(() =>
        setVerificationFee({
          chainId,
          marginNative: marginLamports,
        }),
      );
      if (succeeded) setFeeSaved(true);
    }
  };

  if (!writeAvail.available) {
    return (
      <TxWriteRefusal
        refusal={writeAvail}
        disconnectedTitle="Connect your wallet to set a verification fee."
      />
    );
  }

  if (!surface.configured) {
    return (
      <p className="font-sans text-sm text-text-secondary">
        Staking not configured for this network.
      </p>
    );
  }

  const currencyLabel = marginNative
    ? marginNative.unit.symbol
    : displayCurrencyLabel(displayCurrency);
  const feeSaveDisabled =
    feeSaving ||
    (includesExecutionCost && (!ratesReady || isRatesLoading || marginWei == null)) ||
    (marginNative != null && marginLamports == null);

  return (
    <div className="rounded-md border border-border-default bg-bg-card p-6 md:p-8">
      <div className="space-y-4">
        <div>
          <p className={categoryLabel}>Verification fee</p>
          <p className="mt-1 font-sans text-xs text-text-secondary">{surface.intro}</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="kar-pro-service-fee">Your service fee ({currencyLabel})</Label>
          <Input
            id="kar-pro-service-fee"
            type="text"
            inputMode="decimal"
            placeholder="0"
            value={marginInput}
            onChange={(e) => {
              setMarginInput(e.target.value);
              setFeeSaved(false);
            }}
            disabled={feeSaving || (includesExecutionCost && !ratesReady)}
            className="font-mono tabular-nums"
          />
          {includesExecutionCost && !ratesReady && (
            <p className="font-sans text-xs text-text-secondary">
              Exchange rates unavailable — fee save disabled until rates load.
            </p>
          )}
        </div>

        <div className="space-y-1 rounded-md border border-border-default bg-bg-surface p-4">
          {includesExecutionCost ? (
            <>
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-sans text-xs text-text-tertiary">
                  Verify transaction cost (estimate)
                </span>
                <span className="font-mono text-xs tabular-nums text-text-secondary">
                  {gasLoading ? "…" : gasDisplay ?? "—"}
                  {gasCostWei != null && (
                    <span className="ml-2 text-text-tertiary">
                      {formatFeeWeiEth(gasCostWei)}
                    </span>
                  )}
                </span>
              </div>
              {gasCostWei == null && !gasLoading && (
                <p className="font-sans text-xs text-text-secondary">
                  Gas estimate unavailable. Total may exclude verify transaction
                  cost until you save again.
                </p>
              )}
            </>
          ) : feeUnread != null ? (
            <p className="font-sans text-xs text-text-secondary" role="status">
              {feeUnread.message}
            </p>
          ) : null}

          <div className="flex items-baseline justify-between gap-3 border-t border-border-default pt-2">
            <span className="font-sans text-xs text-text-tertiary">
              {surface.totalLabel}
            </span>
            <span className="font-mono text-sm tabular-nums text-text-primary">
              {totalDisplay ?? "—"}
              {includesExecutionCost && totalWei != null && totalWei > 0n && (
                <span className="ml-2 text-xs text-text-secondary">
                  {formatFeeWeiEth(totalWei)}
                </span>
              )}
            </span>
          </div>
          {((includesExecutionCost && marginWei === 0n) ||
            (marginNative != null && marginLamports === 0n)) &&
            marginDisplay != null && (
              <p className="font-sans text-xs text-text-secondary">
                Empty or zero service fee shows as contact for quote.
              </p>
            )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            disabled={feeSaveDisabled}
            onClick={() => void onSaveFee()}
          >
            {txPhase === "indexing"
              ? "Confirming…"
              : feeSaving
                ? "Saving…"
                : "Save fee"}
          </Button>
          {feeSaved && (
            <p className="font-sans text-sm text-text-secondary" role="status">
              Fee saved
            </p>
          )}
        </div>

        {(feeError ?? txSyncError) && (
          <p role="alert" className="font-sans text-sm text-status-error">
            {feeError ?? txSyncError}
          </p>
        )}
        {syncLagged && (
          <p role="status" className="font-sans text-xs text-text-tertiary">
            {TX_SYNC_LAG_ADVISORY}
          </p>
        )}
      </div>
    </div>
  );
}
