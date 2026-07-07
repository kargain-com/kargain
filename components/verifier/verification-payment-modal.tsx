"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatUnits, stringToHex } from "viem";
import { waitForTransactionReceipt } from "wagmi/actions";
import {
  useAccount,
  useBalance,
  useChainId,
  useConfig,
  useReadContract,
  useSendTransaction,
  useSwitchChain,
  useWriteContract,
} from "wagmi";

import { getProfileData } from "@/app/actions/marketplace-listings";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QrCode } from "@/components/ui/qr-code";
import { NwcConnectField } from "@/components/profile/nwc-connect-field";
import { useNwcWallet, nwcPayErrorMessage } from "@/hooks/use-nwc-wallet";
import { ctaLink } from "@/lib/design/instrument-classes";
import { parseLud16 } from "@/lib/lightning/lud16";
import {
  fetchLnurlPayInvoice,
  fetchLnurlVerifySettled,
  lnurlPayErrorMessage,
} from "@/lib/lightning/lnurl-pay-client";
import { txErrorMessage } from "@/lib/marketplace/tx-error-message";
import { useMarketRates } from "@/lib/marketplace/use-market-rates";
import { formatPassportTitle } from "@/lib/passport/passport-token-id";
import { KarProStakingAbi } from "@/lib/contracts/abis.generated";
import {
  formatVerificationFee,
  verificationFeeInSats,
  verificationFeeInUsdc,
} from "@/lib/verifier/verification-fee";
import { acceptedPaymentMethods } from "@/lib/verifier/payment-methods";
import { useNostrProfile } from "@/hooks/use-nostr-profile";
import { karProStakingAddress, usdcAddress } from "@/lib/web3/deployment-addresses";
import { DEFAULT_CHAIN_ID, wagmiChainId } from "@/lib/web3/supported-chains";
import { cn } from "@/lib/utils";

const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const LIGHTNING_VERIFY_POLL_MS = 3_000;
const LIGHTNING_VERIFY_MAX_MS = 5 * 60 * 1000;

type PaymentMethod = "ETH" | "USDC" | "LIGHTNING";

type PassportRow = {
  id?: unknown;
  status?: string;
  make?: string;
  model?: string;
  year?: number;
};

type ModalPhase = "form" | "success";

type VerificationPaymentModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  verifierAddress: `0x${string}`;
  feeWei: bigint;
  verifierName?: string;
};

const GHOST_BUTTON_CLASS =
  "inline-flex items-center justify-center font-sans text-sm font-medium text-text-secondary border-0 bg-transparent px-4 py-2 rounded-sm min-h-11 transition-colors duration-200 hover:text-text-primary hover:bg-bg-surface focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]";

function passportLabel(row: PassportRow): string {
  const id = row.id != null ? String(row.id) : "";
  const title = id ? formatPassportTitle(id) : "Passport";
  const vehicle = [row.make, row.model, row.year].filter(Boolean).join(" ");
  return vehicle ? `${title} — ${vehicle}` : title;
}

function formatSatsLabel(sats: bigint): string {
  return `${sats.toLocaleString("en-US")} sats`;
}

function TrustDisclaimer({ lightning }: { lightning?: boolean }) {
  return (
    <div className="space-y-2">
      <p className="font-sans text-xs text-text-secondary">
        This payment goes directly to the verifier. Kargain does not hold or verify funds.
        Verification is confirmed on-chain separately after the verifier completes the
        inspection.
      </p>
      {lightning && (
        <p className="font-sans text-xs text-text-secondary">
          Passport reference in the payment comment is provider-dependent and may not appear on
          all invoices.
        </p>
      )}
    </div>
  );
}

export function VerificationPaymentModal({
  open,
  onOpenChange,
  verifierAddress,
  feeWei,
  verifierName,
}: VerificationPaymentModalProps) {
  const chainId = DEFAULT_CHAIN_ID;
  const config = useConfig();
  const wc = wagmiChainId(chainId);
  const { address, isConnected } = useAccount();
  const walletChain = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync, isPending: isEthPending } = useSendTransaction();
  const { writeContractAsync, isPending: isWritePending } = useWriteContract();
  const { ethUsd, btcUsd, isLoading: ratesLoading } = useMarketRates({ enabled: open });
  const { profile: verifierProfile } = useNostrProfile(verifierAddress, undefined, {
    enabled: open,
  });

  const usdc = usdcAddress(chainId);
  const staking = karProStakingAddress(chainId);
  const wrongChain = walletChain !== chainId;
  const isPending = isEthPending || isWritePending;

  const { data: chainFeeWei } = useReadContract({
    address: staking,
    abi: KarProStakingAbi,
    functionName: "verificationFee",
    args: [verifierAddress],
    query: { enabled: Boolean(open && staking) },
  });

  const effectiveFeeWei = chainFeeWei ?? feeWei;
  const chainFeeResolved = chainFeeWei !== undefined;
  const zeroFee = chainFeeResolved && effectiveFeeWei === 0n;

  const [phase, setPhase] = useState<ModalPhase>("form");
  const [successViaLightning, setSuccessViaLightning] = useState(false);
  const [successViaNwc, setSuccessViaNwc] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("ETH");
  const [txError, setTxError] = useState<string | null>(null);
  const [passportsLoading, setPassportsLoading] = useState(false);
  const [unverifiedPassports, setUnverifiedPassports] = useState<PassportRow[]>([]);
  const [selectedTokenId, setSelectedTokenId] = useState("");
  const [manualTokenId, setManualTokenId] = useState("");
  const [lightningInvoice, setLightningInvoice] = useState<string | null>(null);
  const [lightningVerifyUrl, setLightningVerifyUrl] = useState<string | null>(null);
  const [lightningLoading, setLightningLoading] = useState(false);
  const [lightningError, setLightningError] = useState<string | null>(null);
  const [copyDone, setCopyDone] = useState(false);
  const [nwcPending, setNwcPending] = useState(false);
  const [nwcError, setNwcError] = useState<string | null>(null);
  const [showNwcConnect, setShowNwcConnect] = useState(false);
  const lightningFetchKeyRef = useRef("");
  const { present: nwcPresent, connect: nwcConnect, payInvoice: nwcPayInvoice } = useNwcWallet();

  const verifierLud16 = useMemo(
    () => parseLud16(verifierProfile?.lud16 ?? ""),
    [verifierProfile?.lud16],
  );

  const acceptedMethods = useMemo(
    () => acceptedPaymentMethods(verifierProfile),
    [verifierProfile],
  );

  const ethSegmentVisible = acceptedMethods.has("eth");
  const usdcSegmentVisible = acceptedMethods.has("usdc");
  const lightningSegmentVisible =
    acceptedMethods.has("lightning") && verifierLud16 != null;
  const noOnlineMethods =
    !ethSegmentVisible && !usdcSegmentVisible && !lightningSegmentVisible;

  const useDropdown = unverifiedPassports.length > 0;
  const tokenId = (useDropdown ? selectedTokenId : manualTokenId).trim();
  const hasTokenId = tokenId.length > 0;

  const usdcAmount =
    ethUsd != null && ethUsd > 0n
      ? verificationFeeInUsdc(effectiveFeeWei, ethUsd)
      : 0n;
  const usdcOptionDisabled =
    !usdcSegmentVisible ||
    !usdc ||
    ratesLoading ||
    ethUsd == null ||
    ethUsd === 0n ||
    usdcAmount === 0n;

  const satsAmount =
    ethUsd != null && btcUsd != null && ethUsd > 0n && btcUsd > 0n
      ? verificationFeeInSats(effectiveFeeWei, ethUsd, btcUsd)
      : 0n;
  const lightningRatesUnavailable =
    ratesLoading || ethUsd == null || ethUsd === 0n || btcUsd == null || btcUsd === 0n;

  const { data: ethBalance } = useBalance({
    address,
    chainId: wc,
    query: { enabled: Boolean(address && open) },
  });

  const { data: usdcBalance } = useReadContract({
    address: usdc,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: wc,
    query: { enabled: Boolean(usdc && address && open) },
  });

  const insufficientEthBalance =
    paymentMethod === "ETH" &&
    ethBalance != null &&
    ethBalance.value < effectiveFeeWei;

  const insufficientUsdcBalance =
    paymentMethod === "USDC" &&
    usdcBalance != null &&
    usdcAmount > 0n &&
    usdcBalance < usdcAmount;

  const resetLightningState = useCallback(() => {
    setLightningInvoice(null);
    setLightningVerifyUrl(null);
    setLightningLoading(false);
    setLightningError(null);
    setCopyDone(false);
    setNwcPending(false);
    setNwcError(null);
    setShowNwcConnect(false);
    lightningFetchKeyRef.current = "";
  }, []);

  const resetForm = useCallback(() => {
    setPhase("form");
    setSuccessViaLightning(false);
    setSuccessViaNwc(false);
    setPaymentMethod("ETH");
    setTxError(null);
    setSelectedTokenId("");
    setManualTokenId("");
    setUnverifiedPassports([]);
    resetLightningState();
  }, [resetLightningState]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) resetForm();
      onOpenChange(next);
    },
    [onOpenChange, resetForm],
  );

  useEffect(() => {
    if (!open || !isConnected || !address) return;
    let cancelled = false;
    setPassportsLoading(true);
    void (async () => {
      try {
        const data = await getProfileData(address);
        const unverified = (data.passports as PassportRow[]).filter(
          (p) => p.status === "UNVERIFIED",
        );
        if (cancelled) return;
        setUnverifiedPassports(unverified);
        const firstId = unverified[0]?.id != null ? String(unverified[0].id) : "";
        setSelectedTokenId(firstId);
      } catch {
        if (!cancelled) setUnverifiedPassports([]);
      } finally {
        if (!cancelled) setPassportsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, isConnected, address]);

  useEffect(() => {
    if (phase !== "success" || !open) return;
    const timer = window.setTimeout(() => handleOpenChange(false), 4000);
    return () => window.clearTimeout(timer);
  }, [phase, open, handleOpenChange]);

  useEffect(() => {
    if (zeroFee) return;
    if (!open || paymentMethod !== "LIGHTNING" || !lightningSegmentVisible || !hasTokenId) {
      return;
    }
    if (lightningRatesUnavailable || satsAmount === 0n || !verifierProfile?.lud16) {
      return;
    }

    const fetchKey = `${verifierProfile.lud16}:${tokenId}:${satsAmount.toString()}`;
    if (lightningFetchKeyRef.current === fetchKey) return;
    lightningFetchKeyRef.current = fetchKey;

    let cancelled = false;
    setLightningLoading(true);
    setLightningError(null);
    setLightningInvoice(null);
    setLightningVerifyUrl(null);

    void (async () => {
      const result = await fetchLnurlPayInvoice({
        address: verifierProfile.lud16!,
        amountMsat: satsAmount * 1000n,
        comment: `kargain:verify:${tokenId}`,
      });
      if (cancelled) return;
      setLightningLoading(false);
      if (!result.ok) {
        setLightningError(lnurlPayErrorMessage(result.error));
        return;
      }
      setLightningInvoice(result.data.invoice);
      setLightningVerifyUrl(result.data.verifyUrl ?? null);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    open,
    zeroFee,
    paymentMethod,
    lightningSegmentVisible,
    hasTokenId,
    lightningRatesUnavailable,
    satsAmount,
    verifierProfile?.lud16,
    tokenId,
  ]);

  useEffect(() => {
    if (!open || !lightningVerifyUrl || phase === "success") return;

    const startedAt = Date.now();
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      if (Date.now() - startedAt > LIGHTNING_VERIFY_MAX_MS) return;

      const settled = await fetchLnurlVerifySettled(lightningVerifyUrl);
      if (cancelled) return;
      if (settled) {
        setSuccessViaLightning(true);
        setPhase("success");
      }
    };

    void poll();
    const interval = window.setInterval(() => {
      void poll();
    }, LIGHTNING_VERIFY_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [open, lightningVerifyUrl, phase]);

  useEffect(() => {
    const visible: PaymentMethod[] = [];
    if (ethSegmentVisible) visible.push("ETH");
    if (usdcSegmentVisible && !usdcOptionDisabled) visible.push("USDC");
    if (lightningSegmentVisible) visible.push("LIGHTNING");

    if (visible.length === 0) return;

    if (!visible.includes(paymentMethod)) {
      setPaymentMethod(visible[0] ?? "ETH");
      resetLightningState();
    }
  }, [
    ethSegmentVisible,
    usdcSegmentVisible,
    lightningSegmentVisible,
    usdcOptionDisabled,
    paymentMethod,
    resetLightningState,
  ]);

  const payEth = useCallback(async () => {
    if (!hasTokenId) return;
    setTxError(null);
    try {
      if (wrongChain) await switchChainAsync?.({ chainId: wc });
      const hash = await sendTransactionAsync({
        to: verifierAddress,
        value: effectiveFeeWei,
        data: stringToHex(`kargain:verify:${tokenId}`),
        chainId: wc,
      });
      await waitForTransactionReceipt(config, { hash });
      setSuccessViaLightning(false);
      setPhase("success");
    } catch (err) {
      setTxError(txErrorMessage(err));
    }
  }, [
    config,
    effectiveFeeWei,
    hasTokenId,
    sendTransactionAsync,
    switchChainAsync,
    tokenId,
    verifierAddress,
    wc,
    wrongChain,
  ]);

  const payUsdc = useCallback(async () => {
    if (!usdc || !hasTokenId || usdcAmount === 0n) return;
    setTxError(null);
    try {
      if (wrongChain) await switchChainAsync?.({ chainId: wc });
      const hash = await writeContractAsync({
        address: usdc,
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [verifierAddress, usdcAmount],
        chainId: wc,
      });
      await waitForTransactionReceipt(config, { hash });
      setSuccessViaLightning(false);
      setPhase("success");
    } catch (err) {
      setTxError(txErrorMessage(err));
    }
  }, [
    config,
    hasTokenId,
    switchChainAsync,
    usdc,
    usdcAmount,
    verifierAddress,
    wc,
    wrongChain,
    writeContractAsync,
  ]);

  const handlePay = useCallback(() => {
    if (paymentMethod === "ETH") void payEth();
    else void payUsdc();
  }, [paymentMethod, payEth, payUsdc]);

  const handleCopyInvoice = useCallback(async () => {
    if (!lightningInvoice) return;
    try {
      await navigator.clipboard.writeText(lightningInvoice);
      setCopyDone(true);
      window.setTimeout(() => setCopyDone(false), 2000);
    } catch {
      setLightningError("Could not copy invoice. Try again.");
    }
  }, [lightningInvoice]);

  const payDisabled = useMemo(() => {
    if (!hasTokenId || isPending || wrongChain) return true;
    if (paymentMethod === "ETH") {
      return insufficientEthBalance;
    }
    if (paymentMethod === "USDC") {
      return usdcOptionDisabled || insufficientUsdcBalance;
    }
    return true;
  }, [
    hasTokenId,
    insufficientEthBalance,
    insufficientUsdcBalance,
    isPending,
    paymentMethod,
    usdcOptionDisabled,
    wrongChain,
  ]);

  const title = verifierName?.trim()
    ? `Pay for inspection — ${verifierName.trim()}`
    : "Pay for inspection";

  const successDescription = successViaNwc
    ? "Payment sent from your connected wallet."
    : successViaLightning
      ? "Payment confirmed by the verifier's Lightning provider."
      : "Payment sent. The verifier will be notified via the blockchain.";

  const handleNwcPay = useCallback(async () => {
    if (!lightningInvoice || nwcPending) return;
    setNwcError(null);
    setNwcPending(true);
    const result = await nwcPayInvoice(lightningInvoice);
    setNwcPending(false);
    if (result.ok) {
      let markNwc = false;
      setPhase((current) => {
        if (current === "success") return current;
        markNwc = true;
        return "success";
      });
      if (markNwc) setSuccessViaNwc(true);
      return;
    }
    setNwcError(nwcPayErrorMessage(result.code));
  }, [lightningInvoice, nwcPayInvoice, nwcPending]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent showClose className="max-w-md">
        {phase === "success" ? (
          <>
            <DialogHeader>
              <DialogTitle>Payment sent</DialogTitle>
              <DialogDescription>{successDescription}</DialogDescription>
            </DialogHeader>
            <Button type="button" variant="secondary" onClick={() => handleOpenChange(false)}>
              Done
            </Button>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>
                Send the verification fee directly to the verifier. Kargain does not custody
                funds.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="verification-passport-select">Passport</Label>
                {passportsLoading ? (
                  <p className="font-sans text-sm text-text-secondary">Loading passports…</p>
                ) : useDropdown ? (
                  <select
                    id="verification-passport-select"
                    value={selectedTokenId}
                    onChange={(e) => {
                      setSelectedTokenId(e.target.value);
                      resetLightningState();
                    }}
                    disabled={isPending}
                    className="w-full min-h-11 rounded-sm border border-border-default bg-bg-card py-3 pl-4 pr-9 font-sans text-sm text-text-primary transition-colors duration-200 focus:border-accent-warm focus:bg-bg-surface focus:outline-none focus-visible:shadow-[var(--focus-ring)]"
                  >
                    {unverifiedPassports.map((p) => {
                      const id = p.id != null ? String(p.id) : "";
                      return (
                        <option key={id} value={id}>
                          {passportLabel(p)}
                        </option>
                      );
                    })}
                  </select>
                ) : (
                  <Input
                    id="verification-passport-select"
                    type="text"
                    placeholder="Passport ID"
                    value={manualTokenId}
                    onChange={(e) => {
                      setManualTokenId(e.target.value);
                      resetLightningState();
                    }}
                    disabled={isPending}
                    className="font-mono"
                  />
                )}
              </div>

              {wrongChain ? (
                <div className="space-y-3 rounded-md border border-border-default bg-bg-surface p-4">
                  <p className="font-sans text-sm text-text-secondary">Switch to Base Sepolia</p>
                  <Button type="button" onClick={() => void switchChainAsync?.({ chainId: wc })}>
                    Switch network
                  </Button>
                </div>
              ) : zeroFee ? (
                <p className="font-sans text-sm text-text-secondary">
                  This verifier has not set a fee. Contact them for a quote.
                </p>
              ) : noOnlineMethods ? (
                <p className="font-sans text-sm text-text-secondary">
                  This verifier has not enabled online payment methods. Contact them to arrange
                  payment.
                </p>
              ) : (
                <>
                  <div className="flex rounded-sm border border-border-default p-0.5">
                    {ethSegmentVisible && (
                    <button
                      type="button"
                      onClick={() => {
                        setTxError(null);
                        setPaymentMethod("ETH");
                        resetLightningState();
                      }}
                      disabled={isPending}
                      className={cn(
                        "flex-1 h-9 rounded-sm border font-sans text-sm font-medium transition-colors duration-200",
                        paymentMethod === "ETH"
                          ? "border-border-hover bg-bg-surface text-text-primary"
                          : "border-transparent bg-transparent text-text-secondary",
                      )}
                    >
                      Pay with ETH
                    </button>
                    )}
                    {usdcSegmentVisible && (
                    <button
                      type="button"
                      disabled={usdcOptionDisabled || isPending}
                      onClick={() => {
                        setTxError(null);
                        setPaymentMethod("USDC");
                        resetLightningState();
                      }}
                      className={cn(
                        "flex-1 h-9 rounded-sm border font-sans text-sm font-medium transition-colors duration-200",
                        paymentMethod === "USDC"
                          ? "border-border-hover bg-bg-surface text-text-primary"
                          : "border-transparent bg-transparent text-text-secondary",
                        usdcOptionDisabled && "cursor-not-allowed opacity-50",
                      )}
                    >
                      Pay with USDC
                    </button>
                    )}
                    {lightningSegmentVisible && (
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => {
                          setTxError(null);
                          setPaymentMethod("LIGHTNING");
                          resetLightningState();
                        }}
                        className={cn(
                          "flex-1 h-9 rounded-sm border font-sans text-sm font-medium transition-colors duration-200",
                          paymentMethod === "LIGHTNING"
                            ? "border-border-hover bg-bg-surface text-text-primary"
                            : "border-transparent bg-transparent text-text-secondary",
                        )}
                      >
                        Pay with Lightning
                      </button>
                    )}
                  </div>

                  <div className="space-y-2 rounded-md border border-border-default bg-bg-surface p-4">
                    {paymentMethod === "ETH" ? (
                      <>
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="font-sans text-xs text-text-tertiary">You pay</span>
                          <span className="font-mono text-xs text-text-secondary">
                            {formatVerificationFee(effectiveFeeWei)}
                          </span>
                        </div>
                        <p className="font-sans text-xs text-text-secondary">
                          Payment includes passport reference on-chain.
                        </p>
                        {insufficientEthBalance && (
                          <p className="font-sans text-xs text-status-error" role="alert">
                            Insufficient ETH balance.
                          </p>
                        )}
                      </>
                    ) : paymentMethod === "USDC" ? (
                      <>
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="font-sans text-xs text-text-tertiary">You pay</span>
                          <span className="font-mono text-xs text-text-secondary">
                            {ratesLoading || usdcOptionDisabled
                              ? "—"
                              : `${formatUnits(usdcAmount, 6)} USDC`}
                          </span>
                        </div>
                        {hasTokenId && (
                          <p className="font-sans text-xs text-text-secondary">
                            Payment for passport #{tokenId}
                          </p>
                        )}
                        <p className="font-sans text-xs text-text-secondary">
                          Passport reference is shown here only, not recorded on-chain for USDC
                          payments.
                        </p>
                        {insufficientUsdcBalance && (
                          <p className="font-sans text-xs text-status-error" role="alert">
                            Insufficient USDC balance.
                          </p>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="font-sans text-xs text-text-tertiary">You pay</span>
                          <span className="font-mono tabular-nums text-sm text-text-primary">
                            {lightningRatesUnavailable || satsAmount === 0n
                              ? "—"
                              : formatSatsLabel(satsAmount)}
                          </span>
                        </div>
                        <p className="font-mono text-xs text-text-secondary">
                          {formatVerificationFee(effectiveFeeWei)}
                        </p>
                        {hasTokenId && (
                          <p className="font-sans text-xs text-text-secondary">
                            Payment for passport #{tokenId}
                          </p>
                        )}
                        {lightningRatesUnavailable && (
                          <p className="font-sans text-xs text-text-secondary">
                            Rates unavailable
                          </p>
                        )}
                        {lightningLoading && (
                          <p className="font-sans text-xs text-text-secondary">
                            Loading Lightning invoice…
                          </p>
                        )}
                        {lightningError && (
                          <p className="font-sans text-sm text-status-error" role="alert">
                            {lightningError}
                          </p>
                        )}
                        {lightningInvoice && (
                          <div className="space-y-3 pt-2">
                            {nwcPresent ? (
                              <div className="space-y-2">
                                <Button
                                  type="button"
                                  variant="primary"
                                  size="sm"
                                  className="w-full"
                                  disabled={nwcPending}
                                  onClick={() => void handleNwcPay()}
                                >
                                  Pay from connected wallet
                                </Button>
                                {nwcPending && (
                                  <p className="font-sans text-sm text-text-secondary">
                                    Waiting for your wallet…
                                  </p>
                                )}
                                {nwcError && (
                                  <p className="font-sans text-sm text-status-error" role="alert">
                                    {nwcError}
                                  </p>
                                )}
                              </div>
                            ) : showNwcConnect ? (
                              <NwcConnectField
                                idPrefix="modal-nwc"
                                onConnect={nwcConnect}
                                disabled={nwcPending}
                                onConnected={() => setShowNwcConnect(false)}
                              />
                            ) : (
                              <button
                                type="button"
                                className="font-sans text-xs text-text-secondary underline-offset-2 hover:text-text-primary hover:underline"
                                onClick={() => setShowNwcConnect(true)}
                              >
                                Connect a Lightning wallet for one-click payments
                              </button>
                            )}
                            <QrCode
                              value={lightningInvoice}
                              ariaLabel="Lightning invoice QR code"
                            />
                            <div className="flex flex-wrap gap-2">
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={() => void handleCopyInvoice()}
                              >
                                {copyDone ? "Copied" : "Copy invoice"}
                              </Button>
                              <a
                                href={`lightning:${lightningInvoice}`}
                                className={cn(
                                  ctaLink,
                                  "inline-flex min-h-11 items-center px-4 py-2 font-sans text-sm",
                                )}
                              >
                                Open in wallet
                              </a>
                            </div>
                            {!lightningVerifyUrl && (
                              <p className="font-sans text-xs text-text-secondary">
                                Payment completes in your Lightning wallet. Kargain cannot confirm
                                Lightning payments.
                              </p>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  <TrustDisclaimer lightning={paymentMethod === "LIGHTNING"} />

                  {paymentMethod === "LIGHTNING" ? (
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-full"
                      onClick={() => handleOpenChange(false)}
                    >
                      Done
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="primary"
                      className="w-full"
                      disabled={payDisabled}
                      onClick={handlePay}
                    >
                      {isPending ? "Sending…" : "Send payment"}
                    </Button>
                  )}

                  {txError && paymentMethod !== "LIGHTNING" && (
                    <p className="font-sans text-sm text-status-error" role="alert">
                      {txError}
                    </p>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

type VerificationPayButtonProps = {
  verifierAddress: `0x${string}`;
  verifierName?: string;
  feeWei: bigint;
  variant?: "secondary" | "ghost" | "outline";
  size?: "default" | "sm";
};

export function VerificationPayButton({
  verifierAddress,
  verifierName,
  feeWei,
  variant = "ghost",
  size,
}: VerificationPayButtonProps) {
  const { address, isConnected } = useAccount();
  const [open, setOpen] = useState(false);

  if (feeWei === 0n) return null;

  if (
    isConnected &&
    address &&
    address.toLowerCase() === verifierAddress.toLowerCase()
  ) {
    return null;
  }

  if (!isConnected) {
    return (
      <button
        type="button"
        disabled
        aria-label="Connect wallet to pay for inspection"
        className={`${GHOST_BUTTON_CLASS} opacity-50 pointer-events-none`}
      >
        Pay for inspection
      </button>
    );
  }

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        onClick={() => setOpen(true)}
        aria-label={
          verifierName
            ? `Pay for inspection with ${verifierName}`
            : "Pay for inspection"
        }
      >
        Pay for inspection
      </Button>
      <VerificationPaymentModal
        open={open}
        onOpenChange={setOpen}
        verifierAddress={verifierAddress}
        feeWei={feeWei}
        verifierName={verifierName}
      />
    </>
  );
}
