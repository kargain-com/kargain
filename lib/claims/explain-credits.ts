import { formatClaimAmount } from "@/lib/claims/format-claim-amount";
import { isNativeClaimAsset } from "@/lib/claims/ids";
import {
  claimReasonExplanation,
  isClaimReasonCode,
  type ClaimReasonCode,
} from "@/lib/claims/reason";

export type ClaimCreditExplainInput = {
  amount: bigint;
  reasonCode: string;
  asset: string;
};

export type ClaimAmountDisplay = {
  decimals: number | null;
  symbol: string | null;
  nativeSymbol?: string;
};

function resolveReasonCode(code: string): ClaimReasonCode {
  return isClaimReasonCode(code) ? code : "unknown";
}

function formatCreditAmount(
  credit: ClaimCreditExplainInput,
  display: ClaimAmountDisplay,
): string {
  const isNative = isNativeClaimAsset(credit.asset);
  return formatClaimAmount({
    amount: credit.amount,
    decimals: display.decimals,
    symbol: display.symbol,
    nativeSymbol: display.nativeSymbol,
    isNative,
  });
}

/** One line: formatted amount + reason for a single credit. */
export function claimCreditLine(
  credit: ClaimCreditExplainInput,
  display: ClaimAmountDisplay = { decimals: null, symbol: null },
): string {
  const amountLabel = formatCreditAmount(credit, display);
  const reason = claimReasonExplanation(resolveReasonCode(credit.reasonCode));
  return `${amountLabel} — ${reason}`;
}

/**
 * Explain an outstanding balance from its ledger credits (chronological).
 * One credit → one line; multiple → one line per credit (each origin visible).
 */
export function explainClaimFromCredits(
  credits: ClaimCreditExplainInput[],
  display: ClaimAmountDisplay = { decimals: null, symbol: null },
): string {
  if (credits.length === 0) {
    return claimReasonExplanation("unknown");
  }
  return credits.map((c) => claimCreditLine(c, display)).join("\n");
}

/** Notification body for the credit that just appeared — never an aggregate. */
export function claimNotificationBody(params: {
  amount: bigint | string;
  asset: string;
  reasonCode: string;
  decimals?: number | null;
  symbol?: string | null;
  nativeSymbol?: string;
}): string {
  const amount =
    typeof params.amount === "bigint" ? params.amount : BigInt(params.amount);
  return claimCreditLine(
    {
      amount,
      reasonCode: params.reasonCode,
      asset: params.asset,
    },
    {
      decimals: params.decimals ?? null,
      symbol: params.symbol ?? null,
      nativeSymbol: params.nativeSymbol,
    },
  );
}
