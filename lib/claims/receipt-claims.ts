import { getAddress, parseEventLogs, type Log, type TransactionReceipt } from "viem";

import { claimablePayoutsAbi } from "@/lib/claims/claimable-payouts-abi";

export type ClaimRecordedFromReceipt = {
  account: `0x${string}`;
  asset: `0x${string}`;
  amount: bigint;
  address: `0x${string}`;
};

/** Parse ClaimRecorded logs from a receipt; optionally filter to one account. */
export function claimRecordedFromReceipt(
  receipt: TransactionReceipt | { logs: Log[] },
  account?: `0x${string}`,
): ClaimRecordedFromReceipt[] {
  const parsed = parseEventLogs({
    abi: claimablePayoutsAbi,
    logs: receipt.logs,
    eventName: "ClaimRecorded",
  });

  const want = account ? getAddress(account) : null;
  const out: ClaimRecordedFromReceipt[] = [];
  for (const ev of parsed) {
    const acct = getAddress(ev.args.account);
    if (want && acct !== want) continue;
    out.push({
      account: acct,
      asset: getAddress(ev.args.asset),
      amount: ev.args.amount,
      address: getAddress(ev.address),
    });
  }
  return out;
}

export function receiptHasClaimForAccount(
  receipt: TransactionReceipt | { logs: Log[] },
  account: `0x${string}`,
): boolean {
  return claimRecordedFromReceipt(receipt, account).length > 0;
}
