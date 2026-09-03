"use client";

import type { ReactNode } from "react";
import { useMemo } from "react";

import { useMarketRatesRequest } from "@/hooks/use-market-rates-request";
import { useDisplayCurrency } from "@/lib/marketplace/display-currency-context";
import type { NostrProfileData } from "@/lib/nostr/parse-profile-content";
import type { PaymentMethodId } from "@/lib/nostr/payment-method-id";
import { paymentMethodChipIds } from "@/lib/verifier/payment-methods";
import {
  formatVerificationFee,
  verificationFeeToUsd1e8,
} from "@/lib/verifier/verification-fee";
import {
  COMMERCIAL_ACTIVE,
  nativeUnitOf,
} from "@/lib/web3/commercial-active";
import { cn } from "@/lib/utils";

const hubNativeUnit = nativeUnitOf(COMMERCIAL_ACTIVE[84532]!);

type VerificationFeeDisplayProps = {
  feeWei: bigint;
  primaryClassName?: string;
  prefix?: ReactNode;
  className?: string;
};

const DEFAULT_PRIMARY =
  "font-mono text-xs text-text-secondary tabular-nums";

const PAYMENT_CHIP_CLASS =
  "rounded-md border border-border-default px-1.5 py-0.5 font-mono text-xs text-text-secondary";

const PAYMENT_CHIP_LABELS: Record<PaymentMethodId, string> = {
  eth: "ETH",
  usdc: "USDC",
  lightning: "Lightning",
};

type VerificationPaymentChipsProps = {
  profile: NostrProfileData | null;
  className?: string;
};

export function VerificationPaymentChips({
  profile,
  className,
}: VerificationPaymentChipsProps) {
  const chipIds = paymentMethodChipIds(profile);
  if (chipIds.length === 0) return null;

  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {chipIds.map((id) => (
        <span key={id} className={PAYMENT_CHIP_CLASS}>
          {PAYMENT_CHIP_LABELS[id]}
        </span>
      ))}
    </span>
  );
}

export function VerificationFeeDisplay({
  feeWei,
  primaryClassName = DEFAULT_PRIMARY,
  prefix,
  className,
}: VerificationFeeDisplayProps) {
  const { displayCurrency, convertPrice, ethUsd } = useDisplayCurrency();

  const needsConversion = feeWei > 0n && displayCurrency !== "ETH";
  useMarketRatesRequest(needsConversion);

  const secondaryLine = useMemo(() => {
    if (!needsConversion) return null;
    if (ethUsd == null || ethUsd <= 0n) return null;

    const usd1e8 = verificationFeeToUsd1e8(feeWei, ethUsd, hubNativeUnit);
    if (usd1e8 <= 0n) return null;

    const converted = convertPrice(usd1e8, 0);
    if (converted === "—") return null;

    return converted;
  }, [needsConversion, feeWei, ethUsd, convertPrice]);

  return (
    <span className={cn("inline-flex flex-col gap-0.5", className)}>
      <span className={primaryClassName}>
        {prefix}
        {formatVerificationFee(feeWei, hubNativeUnit)}
      </span>
      {secondaryLine != null && (
        <span className="font-mono text-xs text-text-tertiary tabular-nums">
          ≈ {secondaryLine}
        </span>
      )}
    </span>
  );
}
