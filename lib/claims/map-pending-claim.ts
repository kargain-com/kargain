import type { PendingClaimApiRow } from "@/app/actions/claims";
import { explainClaimFromCredits } from "@/lib/claims/explain-credits";
import {
  claimableRoleLabel,
  isClaimReasonCode,
  type ClaimReasonCode,
} from "@/lib/claims/reason";
import { isNativeClaimAsset } from "@/lib/claims/ids";
import {
  claimableRoleForAddress,
  type ClaimableContractRole,
} from "@/lib/web3/claimable-contracts";

export type PendingClaimCreditView = {
  id: string;
  amount: bigint;
  reasonCode: ClaimReasonCode;
  timestamp: number;
  asset: `0x${string}`;
};

export type PendingClaimView = {
  id: string;
  chainId: number;
  contract: `0x${string}`;
  account: `0x${string}`;
  asset: `0x${string}`;
  amount: bigint;
  /** Denormalized last-credit hint from the balance row — not used for product copy. */
  reasonCode: ClaimReasonCode;
  /** Ledger-derived explanation (one line per credit). */
  reasonExplanation: string;
  credits: PendingClaimCreditView[];
  role: ClaimableContractRole | null;
  roleLabel: string;
  updatedAt: number;
  firstCreditedAt: number;
  isNative: boolean;
};

function asAddress(value: string): `0x${string}` {
  return value as `0x${string}`;
}

export function mapPendingClaimRow(row: PendingClaimApiRow): PendingClaimView {
  const chainId = Number(row.chainId);
  const contract = asAddress(row.contract);
  const asset = asAddress(row.asset);
  const reasonCode: ClaimReasonCode = isClaimReasonCode(row.reasonCode)
    ? row.reasonCode
    : "unknown";
  const role = Number.isFinite(chainId)
    ? claimableRoleForAddress(chainId, contract)
    : null;

  const credits: PendingClaimCreditView[] = (row.credits ?? []).map((c) => ({
    id: c.id,
    amount: BigInt(c.amount),
    reasonCode: isClaimReasonCode(c.reasonCode) ? c.reasonCode : "unknown",
    timestamp: Number(c.timestamp),
    asset,
  }));

  const reasonExplanation = explainClaimFromCredits(
    credits.map((c) => ({
      amount: c.amount,
      reasonCode: c.reasonCode,
      asset,
    })),
  );

  return {
    id: row.id,
    chainId,
    contract,
    account: asAddress(row.account),
    asset,
    amount: BigInt(row.amount),
    reasonCode,
    reasonExplanation,
    credits,
    role,
    roleLabel: claimableRoleLabel(role),
    updatedAt: Number(row.updatedAt),
    firstCreditedAt: Number(row.firstCreditedAt),
    isNative: isNativeClaimAsset(row.asset),
  };
}

export function mapPendingClaimsResponse(rows: PendingClaimApiRow[]): PendingClaimView[] {
  return rows.map(mapPendingClaimRow).filter((r) => r.amount > 0n);
}
