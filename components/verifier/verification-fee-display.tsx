"use client";

import type { ReactNode } from "react";
import { useMemo } from "react";

import { useMarketRatesRequest } from "@/hooks/use-market-rates-request";
import { useDisplayCurrency } from "@/lib/marketplace/display-currency-context";
import {
  formatVerificationFee,
  verificationFeeToUsd1e8,
} from "@/lib/verifier/verification-fee";
import { cn } from "@/lib/utils";

type VerificationFeeDisplayProps = {
  feeWei: bigint;
  primaryClassName?: string;
  prefix?: ReactNode;
  className?: string;
};

const DEFAULT_PRIMARY =
  "font-mono text-xs text-text-secondary tabular-nums";

export function VerificationLightningChip() {
  return (
    <span className="rounded-md border border-border-default px-1.5 py-0.5 font-mono text-xs text-text-secondary">
      Lightning
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

    const usd1e8 = verificationFeeToUsd1e8(feeWei, ethUsd);
    if (usd1e8 <= 0n) return null;

    const converted = convertPrice(usd1e8, 0);
    if (converted === "—") return null;

    return converted;
  }, [needsConversion, feeWei, ethUsd, convertPrice]);

  return (
    <span className={cn("inline-flex flex-col gap-0.5", className)}>
      <span className={primaryClassName}>
        {prefix}
        {formatVerificationFee(feeWei)}
      </span>
      {secondaryLine != null && (
        <span className="font-mono text-xs text-text-tertiary tabular-nums">
          ≈ {secondaryLine}
        </span>
      )}
    </span>
  );
}
