import { getAddress, zeroAddress } from "viem";

import {
  claimCreditId,
  pendingClaimId,
} from "../../lib/claims/ids";
import {
  inferClaimReason,
  type ClaimReasonCode,
} from "../../lib/claims/reason";
import type { ClaimableContractRole } from "../../lib/web3/claimable-contracts";
import type { PonderFeedItem } from "../../lib/notifications/types";

export type ClaimCreditRow = {
  id: string;
  chainId: number;
  contract: string;
  account: string;
  asset: string;
  amount: bigint;
  reasonCode: string;
  timestamp: bigint;
};

export type PendingClaimRow = {
  id: string;
  chainId: number;
  contract: string;
  account: string;
  asset: string;
  amount: bigint;
  reasonCode: string;
  updatedAt: bigint;
  firstCreditedAt: bigint;
};

function checksumOrZero(addr: string): string {
  if (!addr || addr === "0" || /^0x0+$/i.test(addr)) return zeroAddress;
  return getAddress(addr as `0x${string}`);
}

export function claimRecordedCreditRow(params: {
  chainId: number;
  contract: string;
  account: string;
  asset: string;
  amount: bigint;
  role: ClaimableContractRole;
  txInput: string | undefined;
  txHash: string;
  logIndex: number | bigint;
  timestamp: bigint;
}): ClaimCreditRow {
  const contract = checksumOrZero(params.contract);
  const account = checksumOrZero(params.account);
  const asset = checksumOrZero(params.asset);
  const reasonCode: ClaimReasonCode = inferClaimReason({
    role: params.role,
    txInput: params.txInput,
  });
  return {
    id: claimCreditId(params.txHash, params.logIndex),
    chainId: params.chainId,
    contract,
    account,
    asset,
    amount: params.amount,
    reasonCode,
    timestamp: params.timestamp,
  };
}

export function pendingClaimAfterCredit(params: {
  existing: PendingClaimRow | null;
  credit: ClaimCreditRow;
}): PendingClaimRow {
  const { existing, credit } = params;
  const prev = existing?.amount ?? 0n;
  return {
    id: pendingClaimId({
      chainId: credit.chainId,
      contract: credit.contract,
      account: credit.account,
      asset: credit.asset,
    }),
    chainId: credit.chainId,
    contract: credit.contract,
    account: credit.account,
    asset: credit.asset,
    amount: prev + credit.amount,
    reasonCode: credit.reasonCode,
    updatedAt: credit.timestamp,
    firstCreditedAt: existing?.firstCreditedAt ?? credit.timestamp,
  };
}

export function pendingClaimAfterWithdraw(params: {
  existing: PendingClaimRow;
  timestamp: bigint;
}): PendingClaimRow {
  return {
    ...params.existing,
    amount: 0n,
    updatedAt: params.timestamp,
  };
}

export function claimRecordedNotificationItems(
  rows: ClaimCreditRow[],
  recipient: string,
  since: bigint,
): PonderFeedItem[] {
  const checksum = getAddress(recipient as `0x${string}`);
  return rows
    .filter(
      (r) =>
        getAddress(r.account as `0x${string}`) === checksum && r.timestamp > since,
    )
    .map((r) => ({
      id: `claim.recorded:${r.id}`,
      type: "claim.recorded",
      tokenId: "0",
      timestamp: String(r.timestamp),
      meta: {
        chainId: r.chainId,
        contract: r.contract,
        account: r.account,
        asset: r.asset,
        amount: String(r.amount),
        reasonCode: r.reasonCode,
      },
    }));
}
