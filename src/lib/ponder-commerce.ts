/**
 * Pure builders for FixedPrice / Ascending commerce indexing.
 * Handlers assert rows against reconstructed chain state, not event echo alone.
 */

import { getAddress, zeroAddress } from "viem";

import { claimCreditId, pendingClaimId } from "../../lib/claims/ids";
import { decodeCurrencyCode } from "../../lib/marketplace/currency-code";

export const COMMERCE_PHASE = {
  OFFERED: "offered",
  BINDING: "binding",
  HELD: "held",
  CLOSED: "closed",
  RETURNED: "returned",
} as const;

export type CommercePhase = (typeof COMMERCE_PHASE)[keyof typeof COMMERCE_PHASE];

export const COMMERCE_MODE = {
  FIXED_PRICE: "fixedPrice",
  ASCENDING: "ascending",
} as const;

export type CommerceModeKind = (typeof COMMERCE_MODE)[keyof typeof COMMERCE_MODE];

/** CloseReason enum — Returned=0 … ReversalAbandoned=6 */
export const CLOSE_REASON = {
  RETURNED: 0,
  SOLD: 1,
  EXTERNAL_CONFIRMED: 2,
  HOLD_RELEASED: 3,
  RECALLED: 4,
  REVERSAL_COMPLETED: 5,
  REVERSAL_ABANDONED: 6,
} as const;

export const LIVE_PHASES: ReadonlySet<string> = new Set([
  COMMERCE_PHASE.OFFERED,
  COMMERCE_PHASE.BINDING,
  COMMERCE_PHASE.HELD,
]);

export function checksumOrZero(addr: string): string {
  if (!addr || addr === "0" || /^0x0+$/i.test(addr)) return zeroAddress;
  return getAddress(addr as `0x${string}`);
}

export function currencyCodeText(raw: string | `0x${string}`): string {
  if (!raw || /^0x0+$/i.test(raw)) return "";
  try {
    return decodeCurrencyCode(raw as `0x${string}`);
  } catch {
    return raw;
  }
}

/** Append-only consignment PK from ConsignmentOpened log identity. */
export function consignmentId(params: {
  chainId: number;
  modeContract: string;
  tokenId: string | bigint;
  txHash: string;
  logIndex: number | bigint;
}): string {
  return [
    String(params.chainId),
    params.modeContract.toLowerCase(),
    String(params.tokenId),
    params.txHash.toLowerCase(),
    String(params.logIndex),
  ].join("-");
}

export function mandateId(params: {
  chainId: number;
  modeContract: string;
  tokenId: string | bigint;
}): string {
  return [
    String(params.chainId),
    params.modeContract.toLowerCase(),
    String(params.tokenId),
  ].join("-");
}

export function challengeId(params: {
  chainId: number;
  instanceContract: string;
  subjectId: string | bigint;
  txHash: string;
  logIndex: number | bigint;
}): string {
  return [
    String(params.chainId),
    params.instanceContract.toLowerCase(),
    String(params.subjectId),
    params.txHash.toLowerCase(),
    String(params.logIndex),
  ].join("-");
}

export function commerceModeId(chainId: number, modeContract: string): string {
  return `${chainId}-${modeContract.toLowerCase()}`;
}

export function commercePaymentTokenId(params: {
  chainId: number;
  modeContract: string;
  token: string;
}): string {
  return [
    String(params.chainId),
    params.modeContract.toLowerCase(),
    params.token.toLowerCase(),
  ].join("-");
}

export function commerceCurrencyFeedId(params: {
  chainId: number;
  modeContract: string;
  currencyCode: string;
}): string {
  return [
    String(params.chainId),
    params.modeContract.toLowerCase(),
    params.currencyCode,
  ].join("-");
}

export function bidRowId(txHash: string, logIndex: number | bigint): string {
  return `${txHash.toLowerCase()}-${logIndex}`;
}

/** Terminal phase from CloseReason — Returned → returned; all other closes → closed. */
export function phaseAfterClose(closeReason: number): CommercePhase {
  return closeReason === CLOSE_REASON.RETURNED
    ? COMMERCE_PHASE.RETURNED
    : COMMERCE_PHASE.CLOSED;
}

export function bidExtended(prevEndsAt: bigint | null | undefined, newEndsAt: bigint): boolean {
  if (prevEndsAt == null || prevEndsAt === 0n) return false;
  return newEndsAt > prevEndsAt;
}

/** saleOrdinal = prior opens for (chainId, tokenId) + 1 */
export function nextSaleOrdinal(priorOpenCount: number): number {
  return priorOpenCount + 1;
}

export type ConsignmentOpenedArgs = {
  tokenId: bigint;
  seller: `0x${string}`;
  agent: `0x${string}`;
  asset: `0x${string}`;
  denominationKind: number | bigint;
  currencyCode: `0x${string}`;
  floor: bigint;
  compensationForm: number | bigint;
  commissionBps: number | bigint;
  price: bigint;
  platformFeeBps: number | bigint;
  openedAt: bigint;
};

export function consignmentOpenedRow(params: {
  chainId: number;
  mode: CommerceModeKind;
  modeContract: string;
  args: ConsignmentOpenedArgs;
  saleOrdinal: number;
  txHash: string;
  logIndex: number | bigint;
  timestamp: bigint;
}) {
  const { args } = params;
  const agent = checksumOrZero(args.agent);
  return {
    id: consignmentId({
      chainId: params.chainId,
      modeContract: params.modeContract,
      tokenId: args.tokenId,
      txHash: params.txHash,
      logIndex: params.logIndex,
    }),
    chainId: params.chainId,
    mode: params.mode,
    modeContract: getAddress(params.modeContract as `0x${string}`),
    tokenId: args.tokenId.toString(),
    saleOrdinal: params.saleOrdinal,
    seller: getAddress(args.seller),
    agent: agent === zeroAddress ? "" : agent,
    asset: checksumOrZero(args.asset),
    denominationKind: Number(args.denominationKind),
    currencyCode: currencyCodeText(args.currencyCode),
    floor: args.floor,
    compensationForm: Number(args.compensationForm),
    commissionBps: Number(args.commissionBps),
    price: args.price,
    platformFeeBps: Number(args.platformFeeBps),
    phase: COMMERCE_PHASE.OFFERED,
    closeReason: null as number | null,
    openedAt: args.openedAt,
    closedAt: null as bigint | null,
    recallRequestedAt: null as bigint | null,
    buyer: "",
    settlementNoteSetAt: null as bigint | null,
    settlementNoteSetter: "",
    openTxHash: params.txHash.toLowerCase(),
    openLogIndex: Number(params.logIndex),
    updatedAt: params.timestamp,
  };
}

export type CommerceClaimCause = {
  eventName: string;
  reasonCode: string;
  account: string;
  amount?: bigint;
  asset?: string;
  logIndex: number;
};

/**
 * Correlate ClaimRecorded with same-tx cause events (logIndex < claim).
 * Prefer exact account+amount match; else account-only; else unknown.
 */
export function correlateClaimReason(params: {
  causes: CommerceClaimCause[];
  claimAccount: string;
  claimAmount: bigint;
  claimLogIndex: number;
}): { reasonCode: string; causeEvent: string } {
  const account = checksumOrZero(params.claimAccount).toLowerCase();
  const prior = params.causes
    .filter((c) => c.logIndex < params.claimLogIndex)
    .sort((a, b) => b.logIndex - a.logIndex);

  const amountMatch = prior.find(
    (c) =>
      c.account.toLowerCase() === account &&
      c.amount != null &&
      c.amount === params.claimAmount,
  );
  if (amountMatch) {
    return { reasonCode: amountMatch.reasonCode, causeEvent: amountMatch.eventName };
  }

  const accountMatch = prior.find((c) => c.account.toLowerCase() === account);
  if (accountMatch) {
    return { reasonCode: accountMatch.reasonCode, causeEvent: accountMatch.eventName };
  }

  return { reasonCode: "unknown", causeEvent: "" };
}

/** Known production claim paths → required cause event names (unit gate). */
export const REQUIRED_CLAIM_CAUSE_EVENTS = [
  "BidRefunded",
  "ConsignmentSplitPaid",
  "ChallengeJudged",
  "ChallengeConcluded",
  "ChallengeWithdrawn",
  "ReversalCompleted",
] as const;

export function causeFromBidRefunded(params: {
  bidder: string;
  amount: bigint;
  asset: string;
  logIndex: number;
}): CommerceClaimCause {
  return {
    eventName: "BidRefunded",
    reasonCode: "ascending.outbid_refund",
    account: checksumOrZero(params.bidder),
    amount: params.amount,
    asset: checksumOrZero(params.asset),
    logIndex: params.logIndex,
  };
}

export function causesFromSplitPaid(params: {
  ownerRecipient: string;
  ownerAmount: bigint;
  agentRecipient: string;
  agentAmount: bigint;
  platformRecipient: string;
  platformAmount: bigint;
  asset: string;
  logIndex: number;
}): CommerceClaimCause[] {
  const asset = checksumOrZero(params.asset);
  const out: CommerceClaimCause[] = [];
  if (params.ownerAmount > 0n) {
    out.push({
      eventName: "ConsignmentSplitPaid",
      reasonCode: "consignment.owner_payout",
      account: checksumOrZero(params.ownerRecipient),
      amount: params.ownerAmount,
      asset,
      logIndex: params.logIndex,
    });
  }
  if (params.agentAmount > 0n && params.agentRecipient && !/^0x0+$/i.test(params.agentRecipient)) {
    out.push({
      eventName: "ConsignmentSplitPaid",
      reasonCode: "consignment.agent_payout",
      account: checksumOrZero(params.agentRecipient),
      amount: params.agentAmount,
      asset,
      logIndex: params.logIndex,
    });
  }
  if (params.platformAmount > 0n) {
    out.push({
      eventName: "ConsignmentSplitPaid",
      reasonCode: "consignment.platform_payout",
      account: checksumOrZero(params.platformRecipient),
      amount: params.platformAmount,
      asset,
      logIndex: params.logIndex,
    });
  }
  return out;
}

export function causeFromChallengeTerminal(params: {
  eventName: "ChallengeJudged" | "ChallengeConcluded" | "ChallengeWithdrawn";
  bondRecipient: string;
  bondAmount: bigint;
  logIndex: number;
}): CommerceClaimCause {
  const reason =
    params.eventName === "ChallengeWithdrawn"
      ? "challenge.bond_returned"
      : "challenge.bond_routed";
  return {
    eventName: params.eventName,
    reasonCode: reason,
    account: checksumOrZero(params.bondRecipient),
    amount: params.bondAmount,
    asset: zeroAddress,
    logIndex: params.logIndex,
  };
}

export function causeFromReversal(params: {
  eventName: "ReversalCompleted";
  buyer: string;
  amount?: bigint;
  logIndex: number;
}): CommerceClaimCause {
  return {
    eventName: params.eventName,
    reasonCode: "ascending.reversal_refund",
    account: checksumOrZero(params.buyer),
    amount: params.amount,
    asset: zeroAddress,
    logIndex: params.logIndex,
  };
}

export function commerceClaimCreditRow(params: {
  chainId: number;
  contract: string;
  account: string;
  asset: string;
  amount: bigint;
  reasonCode: string;
  causeEvent: string;
  txHash: string;
  logIndex: number | bigint;
  timestamp: bigint;
}) {
  return {
    id: claimCreditId(params.txHash, params.logIndex),
    chainId: params.chainId,
    contract: checksumOrZero(params.contract),
    account: checksumOrZero(params.account),
    asset: checksumOrZero(params.asset),
    amount: params.amount,
    reasonCode: params.reasonCode,
    causeEvent: params.causeEvent,
    timestamp: params.timestamp,
  };
}

export function commerceClaimAfterCredit(params: {
  existing: {
    id: string;
    chainId: number;
    contract: string;
    account: string;
    asset: string;
    amount: bigint;
    updatedAt: bigint;
    firstCreditedAt: bigint;
  } | null;
  credit: ReturnType<typeof commerceClaimCreditRow>;
}) {
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
    updatedAt: credit.timestamp,
    firstCreditedAt: existing?.firstCreditedAt ?? credit.timestamp,
  };
}

export function commerceClaimAfterWithdraw(params: {
  existing: {
    id: string;
    chainId: number;
    contract: string;
    account: string;
    asset: string;
    amount: bigint;
    updatedAt: bigint;
    firstCreditedAt: bigint;
  };
  timestamp: bigint;
}) {
  return {
    ...params.existing,
    amount: 0n,
    updatedAt: params.timestamp,
  };
}

export function mandateGrantedRow(params: {
  chainId: number;
  mode: CommerceModeKind;
  modeContract: string;
  tokenId: bigint;
  owner: `0x${string}`;
  agent: `0x${string}`;
  expiry: bigint;
  asset: `0x${string}`;
  denominationKind: number | bigint;
  currencyCode: `0x${string}`;
  floor: bigint;
  compensationForm: number | bigint;
  commissionBps: number | bigint;
  timestamp: bigint;
}) {
  return {
    id: mandateId({
      chainId: params.chainId,
      modeContract: params.modeContract,
      tokenId: params.tokenId,
    }),
    chainId: params.chainId,
    modeContract: getAddress(params.modeContract as `0x${string}`),
    mode: params.mode,
    tokenId: params.tokenId.toString(),
    owner: getAddress(params.owner),
    agent: getAddress(params.agent),
    expiry: params.expiry,
    asset: checksumOrZero(params.asset),
    denominationKind: Number(params.denominationKind),
    currencyCode: currencyCodeText(params.currencyCode),
    floor: params.floor,
    compensationForm: Number(params.compensationForm),
    commissionBps: Number(params.commissionBps),
    active: true,
    grantedAt: params.timestamp,
    revokedAt: null as bigint | null,
    updatedAt: params.timestamp,
  };
}

export function challengeOpenedRow(params: {
  chainId: number;
  instance: "passport" | "ascending";
  instanceContract: string;
  subjectId: bigint;
  challenger: `0x${string}`;
  bondAmount: bigint;
  windowDuration: bigint;
  openedAt: bigint;
  txHash: string;
  logIndex: number | bigint;
  timestamp: bigint;
}) {
  return {
    id: challengeId({
      chainId: params.chainId,
      instanceContract: params.instanceContract,
      subjectId: params.subjectId,
      txHash: params.txHash,
      logIndex: params.logIndex,
    }),
    chainId: params.chainId,
    instance: params.instance,
    instanceContract: getAddress(params.instanceContract as `0x${string}`),
    subjectId: params.subjectId.toString(),
    challenger: getAddress(params.challenger),
    bondAmount: params.bondAmount,
    windowDuration: params.windowDuration,
    openedAt: params.openedAt,
    status: "open",
    judge: "",
    outcome: null as number | null,
    bondRecipient: "",
    terminalAt: null as bigint | null,
    terminalTxHash: "",
    openTxHash: params.txHash.toLowerCase(),
    openLogIndex: Number(params.logIndex),
    updatedAt: params.timestamp,
  };
}
