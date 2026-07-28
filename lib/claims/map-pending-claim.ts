import type { PendingClaimApiRow } from "@/app/actions/claims";
import {
  claimReasonExplanation,
  claimableRoleLabel,
  isClaimReasonCode,
  type ClaimReasonCode,
} from "@/lib/claims/reason";
import { isNativeClaimAsset } from "@/lib/claims/ids";
import {
  claimableRoleForAddress,
  type ClaimableContractRole,
} from "@/lib/web3/claimable-contracts";

export type PendingClaimView = {
  id: string;
  chainId: number;
  contract: `0x${string}`;
  account: `0x${string}`;
  asset: `0x${string}`;
  amount: bigint;
  reasonCode: ClaimReasonCode;
  reasonExplanation: string;
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
  const reasonCode: ClaimReasonCode = isClaimReasonCode(row.reasonCode)
    ? row.reasonCode
    : "unknown";
  const role = Number.isFinite(chainId)
    ? claimableRoleForAddress(chainId, contract)
    : null;
  return {
    id: row.id,
    chainId,
    contract,
    account: asAddress(row.account),
    asset: asAddress(row.asset),
    amount: BigInt(row.amount),
    reasonCode,
    reasonExplanation: claimReasonExplanation(reasonCode),
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
