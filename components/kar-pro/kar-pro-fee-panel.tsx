"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { waitForTransactionReceipt } from "wagmi/actions";
import {
  useChainId,
  useConfig,
  useReadContract,
  useSwitchChain,
  useWalletClient,
  useWriteContract,
} from "wagmi";

import { LightningAddressField, isLightningAddressInvalid } from "@/components/profile/lightning-address-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useNostrProfile } from "@/hooks/use-nostr-profile";
import { useVerifyGasEstimate } from "@/hooks/use-verify-gas-estimate";
import { useMarketRatesRequest } from "@/hooks/use-market-rates-request";
import { categoryLabel } from "@/lib/design/instrument-classes";
import { KarProStakingAbi } from "@/lib/contracts/abis.generated";
import { useDisplayCurrency } from "@/lib/marketplace/display-currency-context";
import { fiatCurrencyOptionLabel } from "@/lib/marketplace/fiat-format";
import { pickPartialFxRates } from "@/lib/marketplace/fx-rate-registry";
import { useMarketRates } from "@/lib/marketplace/use-market-rates";
import { txErrorMessage } from "@/lib/marketplace/tx-error-message";
import type { PaymentMethodId } from "@/lib/nostr/payment-method-id";
import { publishNostrProfile } from "@/lib/nostr/profile";
import {
  canComposeFeeInDisplayCurrency,
  composeTotalFeeWei,
  deriveMarginWeiFromOnChain,
  displayAmountToFeeWei,
  formatFeeWeiEth,
  formatFeeWeiInDisplayCurrency,
} from "@/lib/verifier/fee-composer-math";
import {
  acceptedPaymentMethods,
  paymentMethodIdsToArray,
} from "@/lib/verifier/payment-methods";
import { DEFAULT_CHAIN_ID, wagmiChainId } from "@/lib/web3/supported-chains";

type KarProFeePanelProps = {
  address: `0x${string}`;
  staking: `0x${string}` | undefined;
  disabled?: boolean;
};

const PAYMENT_METHOD_LABELS: Record<PaymentMethodId, string> = {
  eth: "ETH",
  usdc: "USDC",
  lightning: "Lightning",
};

function displayCurrencyLabel(currency: string): string {
  if (currency === "ETH" || currency === "BTC") return currency;
  return fiatCurrencyOptionLabel(currency as Parameters<typeof fiatCurrencyOptionLabel>[0]);
}

export function KarProFeePanel({ address, staking, disabled = false }: KarProFeePanelProps) {
  const chainId = DEFAULT_CHAIN_ID;
  const config = useConfig();
  const wc = wagmiChainId(chainId);
  const walletChain = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const { data: walletClient } = useWalletClient({ chainId: wc });

  const { displayCurrency, isRatesLoading, ...rateFields } = useDisplayCurrency();
  const rates = useMemo(() => pickPartialFxRates(rateFields), [rateFields]);

  useMarketRatesRequest(true);
  useMarketRates({ enabled: true });
  const { costWei: gasCostWei, isLoading: gasLoading } = useVerifyGasEstimate({ enabled: true });
  const { profile: ownProfile, refetch: refetchProfile } = useNostrProfile(address);

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

  const resolvedMethods = useMemo(
    () => acceptedPaymentMethods(ownProfile),
    [ownProfile],
  );

  const [methodsDraft, setMethodsDraft] = useState<Set<PaymentMethodId>>(new Set(["eth", "usdc", "lightning"]));
  const [methodsInitialized, setMethodsInitialized] = useState(false);
  const [lud16Draft, setLud16Draft] = useState("");
  const [lud16Touched, setLud16Touched] = useState(false);
  const [lud16Editing, setLud16Editing] = useState(false);
  const [methodsSaving, setMethodsSaving] = useState(false);
  const [methodsSaved, setMethodsSaved] = useState(false);
  const [methodsError, setMethodsError] = useState<string | null>(null);

  useEffect(() => {
    if (marginInitialized || onChainFee === undefined) return;

    const marginWei = deriveMarginWeiFromOnChain(onChainFee, gasCostWei);
    const formatted = formatFeeWeiInDisplayCurrency(marginWei, displayCurrency, rates);
    setMarginInput(formatted ?? (onChainFee > 0n ? formatFeeWeiEth(onChainFee).replace(/ ETH$/, "") : ""));
    setMarginInitialized(true);
  }, [marginInitialized, onChainFee, gasCostWei, displayCurrency, rates]);

  useEffect(() => {
    if (methodsInitialized) return;
    setMethodsDraft(new Set(resolvedMethods));
    setLud16Draft(ownProfile?.lud16 ?? "");
    setMethodsInitialized(true);
  }, [methodsInitialized, resolvedMethods, ownProfile?.lud16]);

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

  const methodsDirty = useMemo(() => {
    if (!methodsInitialized) return false;
    const current = paymentMethodIdsToArray(resolvedMethods).join(",");
    const draft = paymentMethodIdsToArray(methodsDraft).join(",");
    const lud16Changed = (lud16Draft.trim() || "") !== (ownProfile?.lud16 ?? "");
    return current !== draft || lud16Changed;
  }, [methodsInitialized, resolvedMethods, methodsDraft, lud16Draft, ownProfile?.lud16]);

  const lightningEnabled = methodsDraft.has("lightning");
  const lud16Invalid = lightningEnabled && isLightningAddressInvalid(lud16Draft);
  const onlyOneMethod = methodsDraft.size === 1;

  const toggleMethod = useCallback(
    (id: PaymentMethodId, checked: boolean) => {
      setMethodsDraft((prev) => {
        const next = new Set(prev);
        if (checked) {
          next.add(id);
        } else if (next.size > 1) {
          next.delete(id);
        }
        return next;
      });
      setMethodsSaved(false);
    },
    [],
  );

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

  const onSaveMethods = async () => {
    if (!walletClient) {
      setMethodsError("Connect your wallet to save payment methods.");
      return;
    }
    if (lud16Invalid) {
      setLud16Touched(true);
      return;
    }

    setMethodsError(null);
    setMethodsSaved(false);
    setMethodsSaving(true);

    const methodsArray = paymentMethodIdsToArray(methodsDraft);
    const lud16Trimmed = lud16Draft.trim();
    const patch: {
      verifierPaymentMethods: PaymentMethodId[];
      lud16?: string;
    } = { verifierPaymentMethods: methodsArray };

    if (lightningEnabled) {
      patch.lud16 = lud16Trimmed;
    }

    try {
      const ok = await publishNostrProfile(patch, address, {
        signMessage: (msg) => walletClient.signMessage({ message: msg }),
      });
      if (!ok) {
        setMethodsError("Could not publish profile. Try again.");
        return;
      }
      refetchProfile();
      setMethodsSaved(true);
      setLud16Editing(false);
    } catch (err) {
      setMethodsError(err instanceof Error ? err.message : "Save failed. Try again.");
    } finally {
      setMethodsSaving(false);
    }
  };

  const currencyLabel = displayCurrencyLabel(displayCurrency);
  const feeSaveDisabled =
    disabled || feeSaving || !ratesReady || isRatesLoading || marginWei == null;

  return (
    <div className="space-y-8">
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
            disabled={feeSaving || disabled || !ratesReady}
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
            <span className="font-mono tabular-nums text-xs text-text-secondary">
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

          <div className="flex items-baseline justify-between gap-3 pt-2 border-t border-border-default">
            <span className="font-sans text-xs text-text-tertiary">Total on-chain fee</span>
            <span className="font-mono tabular-nums text-sm text-text-primary">
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

      <div className="space-y-4">
        <div>
          <p className={categoryLabel}>Accepted payment methods</p>
          <p className="mt-1 font-sans text-xs text-text-secondary">
            Owners see only the methods you enable when paying your verification fee.
          </p>
        </div>

        <div className="space-y-3">
          {(["eth", "usdc", "lightning"] as const).map((id) => (
            <div key={id} className="flex items-center justify-between gap-4">
              <Label htmlFor={`payment-method-${id}`} className="font-sans text-sm text-text-primary">
                {PAYMENT_METHOD_LABELS[id]}
              </Label>
              <Switch
                id={`payment-method-${id}`}
                checked={methodsDraft.has(id)}
                disabled={disabled || methodsSaving || (methodsDraft.has(id) && onlyOneMethod)}
                onCheckedChange={(checked) => toggleMethod(id, checked)}
              />
            </div>
          ))}
        </div>

        {onlyOneMethod && (
          <p className="font-sans text-xs text-text-secondary">
            At least one payment method must stay enabled.
          </p>
        )}

        {lightningEnabled && (
          <div className="space-y-3">
            {ownProfile?.lud16 && !lud16Editing ? (
              <div className="space-y-2">
                <p className="font-sans text-xs text-text-tertiary">Lightning address</p>
                <p className="font-mono text-sm text-text-primary">{ownProfile.lud16}</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={methodsSaving || disabled}
                  onClick={() => {
                    setLud16Draft(ownProfile.lud16 ?? "");
                    setLud16Editing(true);
                  }}
                >
                  Edit address
                </Button>
              </div>
            ) : (
              <LightningAddressField
                id="kar-pro-lightning-address"
                value={lud16Draft}
                touched={lud16Touched}
                disabled={methodsSaving || disabled}
                onChange={(value) => {
                  setLud16Draft(value);
                  setMethodsSaved(false);
                }}
                onBlur={() => setLud16Touched(true)}
              />
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            disabled={disabled || methodsSaving || !methodsDirty || lud16Invalid}
            onClick={() => void onSaveMethods()}
          >
            {methodsSaving ? "Saving…" : "Save payment methods"}
          </Button>
          {methodsSaved && (
            <p className="font-sans text-sm text-text-secondary" role="status">
              Payment methods saved
            </p>
          )}
        </div>

        {methodsError && (
          <p role="alert" className="font-sans text-sm text-status-error">
            {methodsError}
          </p>
        )}
      </div>
    </div>
  );
}
