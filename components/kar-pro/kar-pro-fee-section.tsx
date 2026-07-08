"use client";

import { useEffect, useMemo, useState } from "react";
import { waitForTransactionReceipt } from "wagmi/actions";
import {
  useChainId,
  useConfig,
  useReadContract,
  useSwitchChain,
  useWriteContract,
} from "wagmi";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useVerifyGasEstimate } from "@/hooks/use-verify-gas-estimate";
import { useMarketRatesRequest } from "@/hooks/use-market-rates-request";
import { categoryLabel } from "@/lib/design/instrument-classes";
import { KarProStakingAbi } from "@/lib/contracts/abis.generated";
import { useDisplayCurrency } from "@/lib/marketplace/display-currency-context";
import { fiatCurrencyOptionLabel } from "@/lib/marketplace/fiat-format";
import { pickPartialFxRates } from "@/lib/marketplace/fx-rate-registry";
import { useMarketRates } from "@/lib/marketplace/use-market-rates";
import { txErrorMessage } from "@/lib/marketplace/tx-error-message";
import {
  canComposeFeeInDisplayCurrency,
  composeTotalFeeWei,
  deriveMarginWeiFromOnChain,
  displayAmountToFeeWei,
  formatFeeWeiEth,
  formatFeeWeiInDisplayCurrency,
} from "@/lib/verifier/fee-composer-math";
import { DEFAULT_CHAIN_ID, wagmiChainId } from "@/lib/web3/supported-chains";

type KarProFeeSectionProps = {
  address: `0x${string}`;
  staking: `0x${string}` | undefined;
};

function displayCurrencyLabel(currency: string): string {
  if (currency === "ETH" || currency === "BTC") return currency;
  return fiatCurrencyOptionLabel(currency as Parameters<typeof fiatCurrencyOptionLabel>[0]);
}

export function KarProFeeSection({ address, staking }: KarProFeeSectionProps) {
  const chainId = DEFAULT_CHAIN_ID;
  const config = useConfig();
  const wc = wagmiChainId(chainId);
  const walletChain = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const { displayCurrency, isRatesLoading, ...rateFields } = useDisplayCurrency();
  const rates = useMemo(() => pickPartialFxRates(rateFields), [rateFields]);

  useMarketRatesRequest(true);
  useMarketRates({ enabled: true });
  const { costWei: gasCostWei, isLoading: gasLoading } = useVerifyGasEstimate({ enabled: true });

  const { data: onChainFee, refetch: refetchFee } = useReadContract({
    address: staking,
    abi: KarProStakingAbi,
    functionName: "verificationFee",
    args: [address],
    query: { enabled: Boolean(staking && address) },
  });

  const wrongChain = walletChain !== chainId;
  const ratesReady = canComposeFeeInDisplayCurrency(displayCurrency, rates);

  const [marginInput, setMarginInput] = useState("");
  const [marginInitialized, setMarginInitialized] = useState(false);
  const [feeSaving, setFeeSaving] = useState(false);
  const [feeSaved, setFeeSaved] = useState(false);
  const [feeError, setFeeError] = useState<string | null>(null);

  useEffect(() => {
    if (marginInitialized || onChainFee === undefined) return;

    const marginWei = deriveMarginWeiFromOnChain(onChainFee, gasCostWei);
    const formatted = formatFeeWeiInDisplayCurrency(marginWei, displayCurrency, rates);
    setMarginInput(formatted ?? (onChainFee > 0n ? formatFeeWeiEth(onChainFee).replace(/ ETH$/, "") : ""));
    setMarginInitialized(true);
  }, [marginInitialized, onChainFee, gasCostWei, displayCurrency, rates]);

  const marginWei = useMemo(
    () => displayAmountToFeeWei(marginInput, displayCurrency, rates),
    [marginInput, displayCurrency, rates],
  );

  const totalWei = useMemo(
    () => (marginWei == null ? null : composeTotalFeeWei(marginWei, gasCostWei)),
    [marginWei, gasCostWei],
  );

  const marginDisplay =
    marginWei != null
      ? formatFeeWeiInDisplayCurrency(marginWei, displayCurrency, rates)
      : null;
  const gasDisplay =
    gasCostWei != null
      ? formatFeeWeiInDisplayCurrency(gasCostWei, displayCurrency, rates)
      : null;
  const totalDisplay =
    totalWei != null
      ? formatFeeWeiInDisplayCurrency(totalWei, displayCurrency, rates)
      : null;

  const onSaveFee = async () => {
    if (!staking) return;
    if (!ratesReady) {
      setFeeError("Exchange rates unavailable. Try again in a moment.");
      return;
    }
    if (marginWei == null || totalWei == null) {
      setFeeError(`Enter a valid amount in ${displayCurrencyLabel(displayCurrency)}.`);
      return;
    }

    setFeeError(null);
    setFeeSaved(false);
    setFeeSaving(true);

    try {
      if (wrongChain) await switchChainAsync?.({ chainId: wc });

      const hash = await writeContractAsync({
        address: staking,
        abi: KarProStakingAbi,
        functionName: "setVerificationFee",
        args: [totalWei],
      });

      await waitForTransactionReceipt(config, { hash });
      void refetchFee();
      setFeeSaved(true);
    } catch (err) {
      setFeeError(txErrorMessage(err));
    } finally {
      setFeeSaving(false);
    }
  };

  const currencyLabel = displayCurrencyLabel(displayCurrency);
  const feeSaveDisabled = feeSaving || !ratesReady || isRatesLoading || marginWei == null;

  return (
    <div className="rounded-md border border-border-default bg-bg-card p-6 md:p-8">
      <div className="space-y-4">
        <div>
          <p className={categoryLabel}>Verification fee</p>
          <p className="mt-1 font-sans text-xs text-text-secondary">
            Your service fee is stored on-chain in ETH. Gas for verifyPassport is included in the
            total when you save. Passport owners pay the published fee — not live gas at payment
            time.
          </p>
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
            disabled={feeSaving || !ratesReady}
            className="font-mono tabular-nums"
          />
          {!ratesReady && (
            <p className="font-sans text-xs text-text-secondary">
              Exchange rates unavailable — fee save disabled until rates load.
            </p>
          )}
        </div>

        <div className="space-y-1 rounded-md border border-border-default bg-bg-surface p-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-sans text-xs text-text-tertiary">Verify transaction cost (estimate)</span>
            <span className="font-mono text-xs tabular-nums text-text-secondary">
              {gasLoading ? "…" : gasDisplay ?? "—"}
              {gasCostWei != null && (
                <span className="ml-2 text-text-tertiary">{formatFeeWeiEth(gasCostWei)}</span>
              )}
            </span>
          </div>
          {gasCostWei == null && !gasLoading && (
            <p className="font-sans text-xs text-text-secondary">
              Gas estimate unavailable. Total may exclude verify transaction cost until you save
              again.
            </p>
          )}

          <div className="flex items-baseline justify-between gap-3 border-t border-border-default pt-2">
            <span className="font-sans text-xs text-text-tertiary">Total on-chain fee</span>
            <span className="font-mono text-sm tabular-nums text-text-primary">
              {totalDisplay ?? "—"}
              {totalWei != null && totalWei > 0n && (
                <span className="ml-2 text-xs text-text-secondary">{formatFeeWeiEth(totalWei)}</span>
              )}
            </span>
          </div>
          {marginDisplay != null && marginWei != null && marginWei === 0n && (
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
            {feeSaving ? "Saving…" : "Save fee"}
          </Button>
          {feeSaved && (
            <p className="font-sans text-sm text-text-secondary" role="status">
              Fee saved
            </p>
          )}
        </div>

        {feeError && (
          <p role="alert" className="font-sans text-sm text-status-error">
            {feeError}
          </p>
        )}
      </div>
    </div>
  );
}
