"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { txErrorMessage } from "@/lib/marketplace/tx-error-message";
import { useMarketRates } from "@/lib/marketplace/use-market-rates";
import { formatPassportTitle } from "@/lib/passport/passport-token-id";
import {
  formatVerificationFee,
  verificationFeeInUsdc,
} from "@/lib/verifier/verification-fee";
import { usdcAddress } from "@/lib/web3/deployment-addresses";
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

type PaymentMethod = "ETH" | "USDC";

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

function TrustDisclaimer() {
  return (
    <p className="font-sans text-xs text-text-secondary">
      This payment goes directly to the verifier. Kargain does not hold or verify funds.
      Verification is confirmed on-chain separately after the verifier completes the
      inspection.
    </p>
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
  const { ethUsd, isLoading: ratesLoading } = useMarketRates();

  const usdc = usdcAddress(chainId);
  const wrongChain = walletChain !== chainId;
  const isPending = isEthPending || isWritePending;

  const [phase, setPhase] = useState<ModalPhase>("form");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("ETH");
  const [txError, setTxError] = useState<string | null>(null);
  const [passportsLoading, setPassportsLoading] = useState(false);
  const [unverifiedPassports, setUnverifiedPassports] = useState<PassportRow[]>([]);
  const [selectedTokenId, setSelectedTokenId] = useState("");
  const [manualTokenId, setManualTokenId] = useState("");

  const useDropdown = unverifiedPassports.length > 0;
  const tokenId = (useDropdown ? selectedTokenId : manualTokenId).trim();
  const hasTokenId = tokenId.length > 0;

  const usdcAmount =
    ethUsd != null && ethUsd > 0n ? verificationFeeInUsdc(feeWei, ethUsd) : 0n;
  const usdcOptionDisabled =
    !usdc || ratesLoading || ethUsd == null || ethUsd === 0n || usdcAmount === 0n;

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
    ethBalance.value < feeWei;

  const insufficientUsdcBalance =
    paymentMethod === "USDC" &&
    usdcBalance != null &&
    usdcAmount > 0n &&
    usdcBalance < usdcAmount;

  const resetForm = useCallback(() => {
    setPhase("form");
    setPaymentMethod("ETH");
    setTxError(null);
    setSelectedTokenId("");
    setManualTokenId("");
    setUnverifiedPassports([]);
  }, []);

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

  const payEth = useCallback(async () => {
    if (!hasTokenId) return;
    setTxError(null);
    try {
      if (wrongChain) await switchChainAsync?.({ chainId: wc });
      const hash = await sendTransactionAsync({
        to: verifierAddress,
        value: feeWei,
        data: stringToHex(`kargain:verify:${tokenId}`),
        chainId: wc,
      });
      await waitForTransactionReceipt(config, { hash });
      setPhase("success");
    } catch (err) {
      setTxError(txErrorMessage(err));
    }
  }, [
    config,
    feeWei,
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

  const payDisabled = useMemo(() => {
    if (!hasTokenId || isPending || wrongChain) return true;
    if (paymentMethod === "ETH") {
      return insufficientEthBalance;
    }
    return usdcOptionDisabled || insufficientUsdcBalance;
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

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent showClose className="max-w-md">
        {phase === "success" ? (
          <>
            <DialogHeader>
              <DialogTitle>Payment sent</DialogTitle>
              <DialogDescription>
                Payment sent. The verifier will be notified via the blockchain.
              </DialogDescription>
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
                    onChange={(e) => setSelectedTokenId(e.target.value)}
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
                    onChange={(e) => setManualTokenId(e.target.value)}
                    disabled={isPending}
                    className="font-mono"
                  />
                )}
              </div>

              {wrongChain ? (
                <div className="space-y-3 rounded-sm border border-border-default bg-bg-surface p-4">
                  <p className="font-sans text-sm text-text-secondary">Switch to Base Sepolia</p>
                  <Button type="button" onClick={() => void switchChainAsync?.({ chainId: wc })}>
                    Switch network
                  </Button>
                </div>
              ) : (
                <>
                  <div className="flex rounded-sm border border-border-default p-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        setTxError(null);
                        setPaymentMethod("ETH");
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
                    <button
                      type="button"
                      disabled={usdcOptionDisabled || isPending}
                      onClick={() => {
                        setTxError(null);
                        setPaymentMethod("USDC");
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
                  </div>

                  <div className="space-y-2 rounded-sm border border-border-default bg-bg-card p-4">
                    {paymentMethod === "ETH" ? (
                      <>
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="font-sans text-xs text-text-tertiary">You pay</span>
                          <span className="font-mono text-xs text-text-secondary">
                            {formatVerificationFee(feeWei)}
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
                    ) : (
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
                    )}
                  </div>

                  <TrustDisclaimer />

                  <Button
                    type="button"
                    variant="primary"
                    className="w-full"
                    disabled={payDisabled}
                    onClick={handlePay}
                  >
                    {isPending ? "Sending…" : "Send payment"}
                  </Button>

                  {txError && (
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
