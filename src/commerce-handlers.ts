/**
 * FixedPriceConsignment + AscendingConsignment Ponder handlers, plus additive
 * KarPassport Challenge* writes into the shared `challenge` table.
 *
 * Scope: contracts/FixedPriceConsignment.sol, contracts/AscendingConsignment.sol,
 * and their shared bases (ConsignmentBase, Mandate, Recall, BondedChallenge,
 * ClaimablePayouts). Live registration deferred to Nuclear #2 — see
 * ponder.schema.ts comment above the `consignment` table. Never writes
 * pending_claim / claim_credit (those stay owned by src/index.ts's
 * role-based ClaimRecorded/ClaimWithdrawn handlers for KarPassport /
 * KarProStaking). The legacy marketplace_* / auction_* schema and handlers have been removed.
 *
 * ClaimRecorded ordering note (why `pendingTxCauses` backfills instead of
 * reading forward): every payout in these contracts routes through
 * `ClaimablePayouts._payNative` / `_payErc20` (see contracts/lib/ClaimablePayouts.sol).
 * Those helpers emit `ClaimRecorded` themselves, *before* returning to the
 * caller — which then emits the descriptive event (`ConsignmentSplitPaid`,
 * `BidRefunded`, `ChallengeJudged`, `ChallengeConcluded`, `ChallengeWithdrawn`,
 * `ReversalCompleted`). So within a transaction, `ClaimRecorded`'s logIndex is
 * always *lower* than its cause's logIndex — the naive "query causes already
 * written to Postgres" approach from the original spec is a no-op in practice
 * (the cause row doesn't exist yet). Instead: causes are pushed into an
 * in-memory per-tx map as their events are indexed (later in the same tx,
 * later logIndex), and any `ClaimRecorded` credit that couldn't be correlated
 * when it was written is parked as "unresolved" and backfilled the moment a
 * matching cause shows up. Ponder indexes handlers for one chain sequentially
 * in block/logIndex order (never parallel), so this is safe across both live
 * indexing and full historical replay. `abandonReversal()` never pays the buyer —
 * it pays the seller split via `_paySplit` / `ConsignmentSplitPaid` only, so there
 * is no `ascending.abandoned_refund` reason (that label was removed as unreachable).
 * Buyer refunds on `completeReversal` correlate via `ReversalCompleted`.
 */

import { ponder } from "ponder:registry";
import {
  ascendingTerms,
  challenge,
  commerceClaim,
  commerceClaimCredit,
  commerceCurrencyFeed,
  commerceMode,
  commercePaymentToken,
  consignment,
  consignmentBid,
  consignmentHold,
  consignmentSettlement,
  mandate,
} from "ponder:schema";
import { and, count, desc, eq, inArray, isNull } from "ponder";
import { getAddress, zeroAddress } from "viem";

import { pendingClaimId } from "../lib/claims/ids";
import {
  COMMERCE_MODE,
  COMMERCE_PHASE,
  LIVE_PHASES,
  type CommerceClaimCause,
  type CommerceModeKind,
  type ConsignmentOpenedArgs,
  bidExtended,
  bidRowId,
  causeFromBidRefunded,
  causeFromChallengeTerminal,
  causeFromReversal,
  causesFromSplitPaid,
  challengeOpenedRow,
  checksumOrZero,
  commerceClaimAfterCredit,
  commerceClaimAfterWithdraw,
  commerceClaimCreditRow,
  commerceCurrencyFeedId,
  commerceModeId,
  commercePaymentTokenId,
  consignmentOpenedRow,
  correlateClaimReason,
  currencyCodeText,
  mandateGrantedRow,
  mandateId,
  nextSaleOrdinal,
  phaseAfterClose,
} from "./lib/ponder-commerce";

// ---------------------------------------------------------------------------
// Event / context types
// ---------------------------------------------------------------------------

type Address = `0x${string}`;
type Hash = `0x${string}`;

/** Ponder 0.16 exposes the indexing network on `context.chain`, not `event.chain`. */
type CommerceContext = Parameters<Parameters<typeof ponder.on>[1]>[0]["context"];

function indexingChainId(context: { chain: { id: number } }): number {
  return Number(context.chain.id);
}

type LogMeta = {
  block: { timestamp: bigint };
  transaction: { hash: Hash };
  log: { address: Address; logIndex: number };
};

type PausedEvent = LogMeta & { args: { account: Address } };
type GuardianSetEvent = LogMeta & { args: { previous: Address; current: Address } };
type ConsignmentOpenedEvent = LogMeta & { args: ConsignmentOpenedArgs };
type ConsignmentPriceSetEvent = LogMeta & {
  args: { tokenId: bigint; setter: Address; newPrice: bigint };
};
type ConsignmentClosedEvent = LogMeta & {
  args: { tokenId: bigint; reason: number | bigint };
};
type ConsignmentSplitPaidEvent = LogMeta & {
  args: {
    tokenId: bigint;
    asset: Address;
    ownerRecipient: Address;
    ownerAmount: bigint;
    agentRecipient: Address;
    agentAmount: bigint;
    platformRecipient: Address;
    platformAmount: bigint;
  };
};
type MandateGrantedEvent = LogMeta & {
  args: {
    tokenId: bigint;
    owner: Address;
    agent: Address;
    expiry: bigint;
    asset: Address;
    denominationKind: number | bigint;
    currencyCode: Hash;
    floor: bigint;
    compensationForm: number | bigint;
    commissionBps: number | bigint;
  };
};
type MandateRevokedEvent = LogMeta & {
  args: { tokenId: bigint; owner: Address; priorAgent: Address };
};
type FloorLoweredEvent = LogMeta & { args: { tokenId: bigint; newFloor: bigint } };
type CommissionLoweredEvent = LogMeta & {
  args: { tokenId: bigint; newBps: number | bigint };
};
type RecallRequestedEvent = LogMeta & {
  args: { tokenId: bigint; seller: Address; requestedAt: bigint };
};
type ClaimEvent = LogMeta & { args: { account: Address; asset: Address; amount: bigint } };

type FixedPricePaymentTokenApprovedEvent = LogMeta & {
  args: { token: Address; feed: Address; decimals: number | bigint };
};
type AscendingPaymentTokenApprovedEvent = LogMeta & { args: { token: Address } };
type PaymentTokenRevokedEvent = LogMeta & { args: { token: Address } };
type CurrencyFeedSetEvent = LogMeta & { args: { currencyCode: Hash; feed: Address } };
type MaxFeedStalenessSetEvent = LogMeta & { args: { previous: bigint; current: bigint } };
type BoughtEvent = LogMeta & {
  args: { tokenId: bigint; buyer: Address; asset: Address; amount: bigint };
};
type SettlementNoteSetEvent = LogMeta & { args: { tokenId: bigint; setter: Address } };
type ExternalPaymentConfirmedEvent = LogMeta & {
  args: { tokenId: bigint; buyer: Address; confirmer: Address };
};

type AuctionRulesSetEvent = LogMeta & {
  args: {
    minDuration: number | bigint;
    maxDuration: number | bigint;
    extensionWindow: number | bigint;
    minIncrementBps: number | bigint;
    minProtectionWindow: number | bigint;
    maxProtectionWindow: number | bigint;
    abandonmentWindow: number | bigint;
    challengeBond: bigint;
  };
};
type BidPlacedEvent = LogMeta & {
  args: { tokenId: bigint; bidder: Address; amount: bigint; endsAt: bigint };
};
type BidRefundedEvent = LogMeta & {
  args: { tokenId: bigint; bidder: Address; asset: Address; amount: bigint };
};
type SettledEvent = LogMeta & {
  args: { tokenId: bigint; buyer: Address; gross: bigint; protectionEndsAt: bigint };
};
/** ReceiptConfirmed / FundsReleased / ReversalCompleted / ReversalAbandoned share this shape. */
type BuyerOnlyEvent = LogMeta & { args: { tokenId: bigint; buyer: Address } };
type ReversalStartedEvent = LogMeta & {
  args: { tokenId: bigint; buyer: Address; abandonmentDeadline: bigint };
};
type AscendingTermsSnapshottedEvent = LogMeta & {
  args: {
    tokenId: bigint;
    duration: number | bigint;
    extensionWindow: number | bigint;
    protectionWindow: number | bigint;
    abandonmentWindow: number | bigint;
    minIncrementBps: number | bigint;
    reserve: bigint;
  };
};

type ChallengeOpenedEvent = LogMeta & {
  args: {
    subjectId: bigint;
    challenger: Address;
    bondAmount: bigint;
    windowDuration: bigint;
    openedAt: bigint;
  };
};
/**
 * Withdrawn/Judged/Concluded share this shape. `judge`/`outcome` only exist on
 * Judged; `bondRecipient` exists on Judged + Concluded but not Withdrawn.
 */
type ChallengeTerminalEvent = LogMeta & {
  args: {
    subjectId: bigint;
    challenger: Address;
    bondAmount: bigint;
    windowDuration: bigint;
    openedAt: bigint;
    judge?: Address;
    outcome?: number | bigint;
    bondRecipient?: Address;
  };
};

// ---------------------------------------------------------------------------
// Same-tx claim-cause correlation (see module doc above)
// ---------------------------------------------------------------------------

type UnresolvedCredit = {
  creditId: string;
  account: string;
  amount: bigint;
};

type PendingTxState = {
  causes: CommerceClaimCause[];
  unresolvedCredits: UnresolvedCredit[];
};

/** Bounded so a long-running process can never leak memory on this map. */
const MAX_PENDING_TX_ENTRIES = 2000;
const pendingTxCauses = new Map<string, PendingTxState>();

function getPendingTxState(txHash: string): PendingTxState {
  const key = txHash.toLowerCase();
  let state = pendingTxCauses.get(key);
  if (!state) {
    state = { causes: [], unresolvedCredits: [] };
    pendingTxCauses.set(key, state);
    if (pendingTxCauses.size > MAX_PENDING_TX_ENTRIES) {
      const oldestKey = pendingTxCauses.keys().next().value;
      if (oldestKey !== undefined) pendingTxCauses.delete(oldestKey);
    }
  }
  return state;
}

function takeCauses(txHash: string): CommerceClaimCause[] {
  return getPendingTxState(txHash).causes;
}

/**
 * Record a same-tx cause, then backfill any earlier-in-tx `ClaimRecorded`
 * credit that could not be correlated when it was first written (see module
 * doc — this is the common path, not the exceptional one).
 */
async function pushCause(
  context: CommerceContext,
  txHash: string,
  cause: CommerceClaimCause,
): Promise<void> {
  const state = getPendingTxState(txHash);
  state.causes.push(cause);

  if (state.unresolvedCredits.length === 0) return;
  const causeAccount = cause.account.toLowerCase();
  const stillUnresolved: UnresolvedCredit[] = [];
  for (const credit of state.unresolvedCredits) {
    const accountMatches = credit.account.toLowerCase() === causeAccount;
    const amountMatches = cause.amount == null || cause.amount === credit.amount;
    if (accountMatches && amountMatches) {
      await context.db.update(commerceClaimCredit, { id: credit.creditId }).set({
        reasonCode: cause.reasonCode,
        causeEvent: cause.eventName,
      });
    } else {
      stillUnresolved.push(credit);
    }
  }
  state.unresolvedCredits = stillUnresolved;
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

async function findLiveConsignment(
  context: CommerceContext,
  chainId: number,
  modeContract: string,
  tokenId: bigint | string,
) {
  const contract = getAddress(modeContract as Address);
  const rows = await context.db.sql
    .select()
    .from(consignment)
    .where(
      and(
        eq(consignment.chainId, chainId),
        eq(consignment.modeContract, contract),
        eq(consignment.tokenId, tokenId.toString()),
        inArray(consignment.phase, Array.from(LIVE_PHASES)),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function countPriorOpens(
  context: CommerceContext,
  chainId: number,
  tokenId: bigint | string,
): Promise<number> {
  const rows = await context.db.sql
    .select({ value: count() })
    .from(consignment)
    .where(and(eq(consignment.chainId, chainId), eq(consignment.tokenId, tokenId.toString())));
  return Number(rows[0]?.value ?? 0);
}

async function findLiveHold(
  context: CommerceContext,
  chainId: number,
  tokenId: bigint | string,
) {
  const rows = await context.db.sql
    .select()
    .from(consignmentHold)
    .where(
      and(
        eq(consignmentHold.chainId, chainId),
        eq(consignmentHold.tokenId, tokenId.toString()),
        isNull(consignmentHold.clearedAt),
      ),
    )
    .orderBy(desc(consignmentHold.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

async function findOpenChallenge(
  context: CommerceContext,
  chainId: number,
  instanceContract: string,
  subjectId: bigint | string,
) {
  const contract = getAddress(instanceContract as Address);
  const rows = await context.db.sql
    .select()
    .from(challenge)
    .where(
      and(
        eq(challenge.chainId, chainId),
        eq(challenge.instanceContract, contract),
        eq(challenge.subjectId, subjectId.toString()),
        eq(challenge.status, "open"),
      ),
    )
    .orderBy(desc(challenge.openedAt))
    .limit(1);
  return rows[0] ?? null;
}

async function ensureCommerceMode(
  context: CommerceContext,
  params: {
    chainId: number;
    modeContract: string;
    mode: CommerceModeKind;
    timestamp: bigint;
    guardian?: string;
  },
): Promise<void> {
  const modeContract = getAddress(params.modeContract as Address);
  const id = commerceModeId(params.chainId, modeContract);
  await context.db
    .insert(commerceMode)
    .values({
      id,
      chainId: params.chainId,
      modeContract,
      mode: params.mode,
      paused: false,
      guardian: params.guardian ? checksumOrZero(params.guardian) : "",
      minDuration: 0,
      maxDuration: 0,
      extensionWindow: 0,
      minIncrementBps: 0,
      minProtectionWindow: 0,
      maxProtectionWindow: 0,
      abandonmentWindow: 0,
      challengeBond: 0n,
      maxFeedStaleness: 0n,
      updatedAt: params.timestamp,
    })
    .onConflictDoNothing();
}

// ---------------------------------------------------------------------------
// Shared handlers — ConsignmentBase / Mandate / Recall (both modes)
// ---------------------------------------------------------------------------

async function handleConsignmentOpened(
  mode: CommerceModeKind,
  event: ConsignmentOpenedEvent,
  context: CommerceContext,
): Promise<void> {
  const chainId = indexingChainId(context);
  const modeContract = event.log.address;
  const priorOpens = await countPriorOpens(context, chainId, event.args.tokenId);
  const row = consignmentOpenedRow({
    chainId,
    mode,
    modeContract,
    args: event.args,
    saleOrdinal: nextSaleOrdinal(priorOpens),
    txHash: event.transaction.hash,
    logIndex: event.log.logIndex,
    timestamp: event.block.timestamp,
  });
  await context.db.insert(consignment).values(row);
  await ensureCommerceMode(context, {
    chainId,
    modeContract,
    mode,
    timestamp: event.block.timestamp,
  });
}

async function handleConsignmentPriceSet(
  event: ConsignmentPriceSetEvent,
  context: CommerceContext,
): Promise<void> {
  const chainId = indexingChainId(context);
  const live = await findLiveConsignment(context, chainId, event.log.address, event.args.tokenId);
  if (!live) return;
  await context.db.update(consignment, { id: live.id }).set({
    price: event.args.newPrice,
    updatedAt: event.block.timestamp,
  });
}

async function handleConsignmentFloorLowered(
  event: FloorLoweredEvent,
  context: CommerceContext,
): Promise<void> {
  const chainId = indexingChainId(context);
  const live = await findLiveConsignment(context, chainId, event.log.address, event.args.tokenId);
  if (!live) return;
  await context.db.update(consignment, { id: live.id }).set({
    floor: event.args.newFloor,
    updatedAt: event.block.timestamp,
  });
}

async function handleConsignmentCommissionLowered(
  event: CommissionLoweredEvent,
  context: CommerceContext,
): Promise<void> {
  const chainId = indexingChainId(context);
  const live = await findLiveConsignment(context, chainId, event.log.address, event.args.tokenId);
  if (!live) return;
  await context.db.update(consignment, { id: live.id }).set({
    commissionBps: Number(event.args.newBps),
    updatedAt: event.block.timestamp,
  });
}

async function handleConsignmentClosed(
  event: ConsignmentClosedEvent,
  context: CommerceContext,
): Promise<void> {
  const chainId = indexingChainId(context);
  const live = await findLiveConsignment(context, chainId, event.log.address, event.args.tokenId);
  if (!live) return;
  const closeReason = Number(event.args.reason);
  await context.db.update(consignment, { id: live.id }).set({
    phase: phaseAfterClose(closeReason),
    closeReason,
    closedAt: event.block.timestamp,
    updatedAt: event.block.timestamp,
  });
}

async function handleConsignmentSplitPaid(
  event: ConsignmentSplitPaidEvent,
  context: CommerceContext,
): Promise<void> {
  const chainId = indexingChainId(context);
  const live = await findLiveConsignment(context, chainId, event.log.address, event.args.tokenId);
  if (!live) return;

  const agentRecipientChecksum = checksumOrZero(event.args.agentRecipient);
  const agentRecipient = agentRecipientChecksum === zeroAddress ? "" : agentRecipientChecksum;
  const txHash = event.transaction.hash;

  const settlementValues = {
    id: live.id,
    consignmentId: live.id,
    chainId,
    tokenId: event.args.tokenId.toString(),
    asset: checksumOrZero(event.args.asset),
    ownerRecipient: getAddress(event.args.ownerRecipient),
    ownerAmount: event.args.ownerAmount,
    agentRecipient,
    agentAmount: event.args.agentAmount,
    platformRecipient: getAddress(event.args.platformRecipient),
    platformAmount: event.args.platformAmount,
    txHash: txHash.toLowerCase(),
    timestamp: event.block.timestamp,
  };

  await context.db
    .insert(consignmentSettlement)
    .values(settlementValues)
    .onConflictDoUpdate({
      asset: settlementValues.asset,
      ownerRecipient: settlementValues.ownerRecipient,
      ownerAmount: settlementValues.ownerAmount,
      agentRecipient: settlementValues.agentRecipient,
      agentAmount: settlementValues.agentAmount,
      platformRecipient: settlementValues.platformRecipient,
      platformAmount: settlementValues.platformAmount,
      txHash: settlementValues.txHash,
      timestamp: settlementValues.timestamp,
    });

  const causes = causesFromSplitPaid({
    ownerRecipient: event.args.ownerRecipient,
    ownerAmount: event.args.ownerAmount,
    agentRecipient: event.args.agentRecipient,
    agentAmount: event.args.agentAmount,
    platformRecipient: event.args.platformRecipient,
    platformAmount: event.args.platformAmount,
    asset: event.args.asset,
    logIndex: event.log.logIndex,
  });
  for (const cause of causes) {
    await pushCause(context, txHash, cause);
  }
}

async function handleMandateGranted(
  mode: CommerceModeKind,
  event: MandateGrantedEvent,
  context: CommerceContext,
): Promise<void> {
  const chainId = indexingChainId(context);
  const row = mandateGrantedRow({
    chainId,
    mode,
    modeContract: event.log.address,
    tokenId: event.args.tokenId,
    owner: event.args.owner,
    agent: event.args.agent,
    expiry: event.args.expiry,
    asset: event.args.asset,
    denominationKind: event.args.denominationKind,
    currencyCode: event.args.currencyCode,
    floor: event.args.floor,
    compensationForm: event.args.compensationForm,
    commissionBps: event.args.commissionBps,
    timestamp: event.block.timestamp,
  });
  await context.db
    .insert(mandate)
    .values(row)
    .onConflictDoUpdate({
      agent: row.agent,
      expiry: row.expiry,
      asset: row.asset,
      denominationKind: row.denominationKind,
      currencyCode: row.currencyCode,
      floor: row.floor,
      compensationForm: row.compensationForm,
      commissionBps: row.commissionBps,
      active: true,
      grantedAt: row.grantedAt,
      revokedAt: null,
      updatedAt: row.updatedAt,
    });
}

async function handleMandateRevoked(
  event: MandateRevokedEvent,
  context: CommerceContext,
): Promise<void> {
  const chainId = indexingChainId(context);
  const id = mandateId({ chainId, modeContract: event.log.address, tokenId: event.args.tokenId });
  await context.db.update(mandate, { id }).set({
    active: false,
    revokedAt: event.block.timestamp,
    updatedAt: event.block.timestamp,
  });
}

async function handleRecallRequested(
  event: RecallRequestedEvent,
  context: CommerceContext,
): Promise<void> {
  const chainId = indexingChainId(context);
  const live = await findLiveConsignment(context, chainId, event.log.address, event.args.tokenId);
  if (!live) return;
  await context.db.update(consignment, { id: live.id }).set({
    recallRequestedAt: event.args.requestedAt,
    updatedAt: event.block.timestamp,
  });
}

async function handlePaused(
  mode: CommerceModeKind,
  event: PausedEvent,
  context: CommerceContext,
): Promise<void> {
  const chainId = indexingChainId(context);
  await ensureCommerceMode(context, {
    chainId,
    modeContract: event.log.address,
    mode,
    timestamp: event.block.timestamp,
  });
  await context.db
    .update(commerceMode, { id: commerceModeId(chainId, event.log.address) })
    .set({ paused: true, updatedAt: event.block.timestamp });
}

async function handleUnpaused(
  mode: CommerceModeKind,
  event: PausedEvent,
  context: CommerceContext,
): Promise<void> {
  const chainId = indexingChainId(context);
  await ensureCommerceMode(context, {
    chainId,
    modeContract: event.log.address,
    mode,
    timestamp: event.block.timestamp,
  });
  await context.db
    .update(commerceMode, { id: commerceModeId(chainId, event.log.address) })
    .set({ paused: false, updatedAt: event.block.timestamp });
}

async function handleGuardianSet(
  mode: CommerceModeKind,
  event: GuardianSetEvent,
  context: CommerceContext,
): Promise<void> {
  const chainId = indexingChainId(context);
  await ensureCommerceMode(context, {
    chainId,
    modeContract: event.log.address,
    mode,
    timestamp: event.block.timestamp,
    guardian: event.args.current,
  });
  await context.db
    .update(commerceMode, { id: commerceModeId(chainId, event.log.address) })
    .set({ guardian: checksumOrZero(event.args.current), updatedAt: event.block.timestamp });
}

// ---------------------------------------------------------------------------
// ClaimablePayouts — commerce_claim / commerce_claim_credit ONLY
// (never pending_claim / claim_credit — those are index.ts's role-based table)
// ---------------------------------------------------------------------------

async function handleCommerceClaimRecorded(
  event: ClaimEvent,
  context: CommerceContext,
): Promise<void> {
  const chainId = indexingChainId(context);
  const txHash = event.transaction.hash;
  const logIndex = event.log.logIndex;

  // Defensive only — see module doc: causes normally arrive *after* the claim
  // in the same tx, so this is almost always empty at this point.
  const causes = takeCauses(txHash);
  const { reasonCode, causeEvent } = correlateClaimReason({
    causes,
    claimAccount: event.args.account,
    claimAmount: event.args.amount,
    claimLogIndex: logIndex,
  });

  const credit = commerceClaimCreditRow({
    chainId,
    contract: event.log.address,
    account: event.args.account,
    asset: event.args.asset,
    amount: event.args.amount,
    reasonCode,
    causeEvent,
    txHash,
    logIndex,
    timestamp: event.block.timestamp,
  });

  await context.db
    .insert(commerceClaimCredit)
    .values(credit)
    .onConflictDoUpdate({
      amount: credit.amount,
      reasonCode: credit.reasonCode,
      causeEvent: credit.causeEvent,
      timestamp: credit.timestamp,
    });

  if (reasonCode === "unknown") {
    getPendingTxState(txHash).unresolvedCredits.push({
      creditId: credit.id,
      account: credit.account,
      amount: credit.amount,
    });
  }

  const balanceId = pendingClaimId({
    chainId: credit.chainId,
    contract: credit.contract,
    account: credit.account,
    asset: credit.asset,
  });
  const prior = await context.db.find(commerceClaim, { id: balanceId });
  const next = commerceClaimAfterCredit({ existing: prior ?? null, credit });

  await context.db
    .insert(commerceClaim)
    .values(next)
    .onConflictDoUpdate({
      amount: next.amount,
      updatedAt: next.updatedAt,
    });
}

async function handleCommerceClaimWithdrawn(
  event: ClaimEvent,
  context: CommerceContext,
): Promise<void> {
  const chainId = indexingChainId(context);
  const contract = getAddress(event.log.address);
  const account = checksumOrZero(event.args.account);
  const asset = checksumOrZero(event.args.asset);
  const balanceId = pendingClaimId({ chainId, contract, account, asset });
  const prior = await context.db.find(commerceClaim, { id: balanceId });
  if (!prior) return;
  const next = commerceClaimAfterWithdraw({ existing: prior, timestamp: event.block.timestamp });
  await context.db
    .update(commerceClaim, { id: balanceId })
    .set({ amount: next.amount, updatedAt: next.updatedAt });
}

// ---------------------------------------------------------------------------
// FixedPrice only
// ---------------------------------------------------------------------------

async function handleBought(event: BoughtEvent, context: CommerceContext): Promise<void> {
  const chainId = indexingChainId(context);
  const live = await findLiveConsignment(context, chainId, event.log.address, event.args.tokenId);
  if (!live) return;
  await context.db.update(consignment, { id: live.id }).set({
    buyer: getAddress(event.args.buyer),
    updatedAt: event.block.timestamp,
  });
}

async function handleExternalPaymentConfirmed(
  event: ExternalPaymentConfirmedEvent,
  context: CommerceContext,
): Promise<void> {
  const chainId = indexingChainId(context);
  const live = await findLiveConsignment(context, chainId, event.log.address, event.args.tokenId);
  if (!live) return;
  await context.db.update(consignment, { id: live.id }).set({
    buyer: getAddress(event.args.buyer),
    updatedAt: event.block.timestamp,
  });
}

async function handleSettlementNoteSet(
  event: SettlementNoteSetEvent,
  context: CommerceContext,
): Promise<void> {
  const chainId = indexingChainId(context);
  const live = await findLiveConsignment(context, chainId, event.log.address, event.args.tokenId);
  if (!live) return;
  await context.db.update(consignment, { id: live.id }).set({
    settlementNoteSetAt: event.block.timestamp,
    settlementNoteSetter: getAddress(event.args.setter),
    updatedAt: event.block.timestamp,
  });
}

async function handleFixedPricePaymentTokenApproved(
  event: FixedPricePaymentTokenApprovedEvent,
  context: CommerceContext,
): Promise<void> {
  const chainId = indexingChainId(context);
  const modeContract = getAddress(event.log.address);
  const id = commercePaymentTokenId({ chainId, modeContract, token: event.args.token });
  const feedChecksum = checksumOrZero(event.args.feed);
  const values = {
    id,
    chainId,
    modeContract,
    mode: COMMERCE_MODE.FIXED_PRICE,
    token: getAddress(event.args.token),
    feed: feedChecksum === zeroAddress ? "" : feedChecksum,
    decimals: Number(event.args.decimals),
    active: true,
    updatedAt: event.block.timestamp,
  };
  await context.db
    .insert(commercePaymentToken)
    .values(values)
    .onConflictDoUpdate({
      feed: values.feed,
      decimals: values.decimals,
      active: true,
      updatedAt: values.updatedAt,
    });
}

async function handleAscendingPaymentTokenApproved(
  event: AscendingPaymentTokenApprovedEvent,
  context: CommerceContext,
): Promise<void> {
  const chainId = indexingChainId(context);
  const modeContract = getAddress(event.log.address);
  const id = commercePaymentTokenId({ chainId, modeContract, token: event.args.token });
  const values = {
    id,
    chainId,
    modeContract,
    mode: COMMERCE_MODE.ASCENDING,
    token: getAddress(event.args.token),
    feed: "",
    decimals: 0,
    active: true,
    updatedAt: event.block.timestamp,
  };
  await context.db
    .insert(commercePaymentToken)
    .values(values)
    .onConflictDoUpdate({
      active: true,
      updatedAt: values.updatedAt,
    });
}

/** Shared shape `{token}` — used by both FixedPrice and Ascending. */
async function handlePaymentTokenRevoked(
  event: PaymentTokenRevokedEvent,
  context: CommerceContext,
): Promise<void> {
  const chainId = indexingChainId(context);
  const modeContract = getAddress(event.log.address);
  const id = commercePaymentTokenId({ chainId, modeContract, token: event.args.token });
  const existing = await context.db.find(commercePaymentToken, { id });
  if (!existing) return;
  await context.db
    .update(commercePaymentToken, { id })
    .set({ active: false, updatedAt: event.block.timestamp });
}

async function handleCurrencyFeedSet(
  event: CurrencyFeedSetEvent,
  context: CommerceContext,
): Promise<void> {
  const chainId = indexingChainId(context);
  const modeContract = getAddress(event.log.address);
  const currencyCode = currencyCodeText(event.args.currencyCode);
  const id = commerceCurrencyFeedId({ chainId, modeContract, currencyCode });
  const values = {
    id,
    chainId,
    modeContract,
    currencyCode,
    feed: checksumOrZero(event.args.feed),
    updatedAt: event.block.timestamp,
  };
  await context.db
    .insert(commerceCurrencyFeed)
    .values(values)
    .onConflictDoUpdate({
      feed: values.feed,
      updatedAt: values.updatedAt,
    });
}

async function handleMaxFeedStalenessSet(
  event: MaxFeedStalenessSetEvent,
  context: CommerceContext,
): Promise<void> {
  const chainId = indexingChainId(context);
  const modeContract = event.log.address;
  await ensureCommerceMode(context, {
    chainId,
    modeContract,
    mode: COMMERCE_MODE.FIXED_PRICE,
    timestamp: event.block.timestamp,
  });
  await context.db
    .update(commerceMode, { id: commerceModeId(chainId, modeContract) })
    .set({ maxFeedStaleness: event.args.current, updatedAt: event.block.timestamp });
}

// ---------------------------------------------------------------------------
// Ascending only
// ---------------------------------------------------------------------------

async function handleAuctionRulesSet(
  event: AuctionRulesSetEvent,
  context: CommerceContext,
): Promise<void> {
  const chainId = indexingChainId(context);
  const modeContract = event.log.address;
  await ensureCommerceMode(context, {
    chainId,
    modeContract,
    mode: COMMERCE_MODE.ASCENDING,
    timestamp: event.block.timestamp,
  });
  await context.db.update(commerceMode, { id: commerceModeId(chainId, modeContract) }).set({
    minDuration: Number(event.args.minDuration),
    maxDuration: Number(event.args.maxDuration),
    extensionWindow: Number(event.args.extensionWindow),
    minIncrementBps: Number(event.args.minIncrementBps),
    minProtectionWindow: Number(event.args.minProtectionWindow),
    maxProtectionWindow: Number(event.args.maxProtectionWindow),
    abandonmentWindow: Number(event.args.abandonmentWindow),
    challengeBond: event.args.challengeBond,
    updatedAt: event.block.timestamp,
  });
}

async function handleAscendingTermsSnapshotted(
  event: AscendingTermsSnapshottedEvent,
  context: CommerceContext,
): Promise<void> {
  const chainId = indexingChainId(context);
  const live = await findLiveConsignment(context, chainId, event.log.address, event.args.tokenId);
  if (!live) return;
  await context.db.insert(ascendingTerms).values({
    id: live.id,
    consignmentId: live.id,
    chainId,
    tokenId: event.args.tokenId.toString(),
    duration: Number(event.args.duration),
    extensionWindow: Number(event.args.extensionWindow),
    protectionWindow: Number(event.args.protectionWindow),
    abandonmentWindow: Number(event.args.abandonmentWindow),
    minIncrementBps: Number(event.args.minIncrementBps),
    reserve: event.args.reserve,
  });
}

async function handleBidPlaced(event: BidPlacedEvent, context: CommerceContext): Promise<void> {
  const chainId = indexingChainId(context);
  const live = await findLiveConsignment(context, chainId, event.log.address, event.args.tokenId);
  if (!live) return;

  const priorBidRows = await context.db.sql
    .select({ endsAt: consignmentBid.endsAt })
    .from(consignmentBid)
    .where(eq(consignmentBid.consignmentId, live.id))
    .orderBy(desc(consignmentBid.endsAt))
    .limit(1);
  const prevEndsAt = priorBidRows[0]?.endsAt ?? null;
  const extended = bidExtended(prevEndsAt, event.args.endsAt);

  await context.db.insert(consignmentBid).values({
    id: bidRowId(event.transaction.hash, event.log.logIndex),
    consignmentId: live.id,
    chainId,
    tokenId: event.args.tokenId.toString(),
    bidder: getAddress(event.args.bidder),
    amount: event.args.amount,
    endsAt: event.args.endsAt,
    extended,
    refunded: false,
    refundAsset: "",
    refundAmount: null,
    refundTxHash: "",
    timestamp: event.block.timestamp,
  });

  if (live.phase === COMMERCE_PHASE.OFFERED) {
    await context.db.update(consignment, { id: live.id }).set({
      phase: COMMERCE_PHASE.BINDING,
      updatedAt: event.block.timestamp,
    });
  }
}

async function handleBidRefunded(
  event: BidRefundedEvent,
  context: CommerceContext,
): Promise<void> {
  const chainId = indexingChainId(context);
  const live = await findLiveConsignment(context, chainId, event.log.address, event.args.tokenId);
  const bidder = getAddress(event.args.bidder);
  const txHash = event.transaction.hash;

  if (live) {
    const rows = await context.db.sql
      .select({ id: consignmentBid.id })
      .from(consignmentBid)
      .where(
        and(
          eq(consignmentBid.consignmentId, live.id),
          eq(consignmentBid.bidder, bidder),
          eq(consignmentBid.refunded, false),
        ),
      )
      .orderBy(desc(consignmentBid.timestamp))
      .limit(1);

    const bidRow = rows[0];
    if (bidRow) {
      await context.db.update(consignmentBid, { id: bidRow.id }).set({
        refunded: true,
        refundAsset: checksumOrZero(event.args.asset),
        refundAmount: event.args.amount,
        refundTxHash: txHash.toLowerCase(),
      });
    }
  }

  await pushCause(
    context,
    txHash,
    causeFromBidRefunded({
      bidder,
      amount: event.args.amount,
      asset: event.args.asset,
      logIndex: event.log.logIndex,
    }),
  );
}

async function handleSettled(event: SettledEvent, context: CommerceContext): Promise<void> {
  const chainId = indexingChainId(context);
  const live = await findLiveConsignment(context, chainId, event.log.address, event.args.tokenId);
  if (!live) return;

  await context.db.update(consignment, { id: live.id }).set({
    phase: COMMERCE_PHASE.HELD,
    updatedAt: event.block.timestamp,
  });

  await context.db.insert(consignmentHold).values({
    id: live.id,
    consignmentId: live.id,
    chainId,
    tokenId: event.args.tokenId.toString(),
    buyer: getAddress(event.args.buyer),
    gross: event.args.gross,
    protectionEndsAt: event.args.protectionEndsAt,
    state: "active",
    abandonmentDeadline: null,
    receiptConfirmedAt: null,
    fundsReleasedAt: null,
    reversalStartedAt: null,
    clearedAt: null,
    createdAt: event.block.timestamp,
    updatedAt: event.block.timestamp,
  });
}

async function handleReceiptConfirmed(
  event: BuyerOnlyEvent,
  context: CommerceContext,
): Promise<void> {
  const chainId = indexingChainId(context);
  const hold = await findLiveHold(context, chainId, event.args.tokenId);
  if (!hold) return;
  await context.db.update(consignmentHold, { id: hold.id }).set({
    state: "receiptConfirmed",
    receiptConfirmedAt: event.block.timestamp,
    clearedAt: event.block.timestamp,
    updatedAt: event.block.timestamp,
  });
}

async function handleFundsReleased(
  event: BuyerOnlyEvent,
  context: CommerceContext,
): Promise<void> {
  const chainId = indexingChainId(context);
  const hold = await findLiveHold(context, chainId, event.args.tokenId);
  if (!hold) return;
  await context.db.update(consignmentHold, { id: hold.id }).set({
    state: "fundsReleased",
    fundsReleasedAt: event.block.timestamp,
    clearedAt: event.block.timestamp,
    updatedAt: event.block.timestamp,
  });
}

async function handleReversalStarted(
  event: ReversalStartedEvent,
  context: CommerceContext,
): Promise<void> {
  const chainId = indexingChainId(context);
  const hold = await findLiveHold(context, chainId, event.args.tokenId);
  if (!hold) return;
  await context.db.update(consignmentHold, { id: hold.id }).set({
    state: "reversalStarted",
    reversalStartedAt: event.block.timestamp,
    abandonmentDeadline: event.args.abandonmentDeadline,
    updatedAt: event.block.timestamp,
  });
}

async function handleReversalCompleted(
  event: BuyerOnlyEvent,
  context: CommerceContext,
): Promise<void> {
  const chainId = indexingChainId(context);
  const hold = await findLiveHold(context, chainId, event.args.tokenId);
  if (!hold) return;

  await context.db.update(consignmentHold, { id: hold.id }).set({
    state: "reversalCompleted",
    clearedAt: event.block.timestamp,
    updatedAt: event.block.timestamp,
  });

  await pushCause(
    context,
    event.transaction.hash,
    causeFromReversal({
      eventName: "ReversalCompleted",
      buyer: hold.buyer,
      amount: hold.gross,
      logIndex: event.log.logIndex,
    }),
  );
}

async function handleReversalAbandoned(
  event: BuyerOnlyEvent,
  context: CommerceContext,
): Promise<void> {
  const chainId = indexingChainId(context);
  const hold = await findLiveHold(context, chainId, event.args.tokenId);
  if (!hold) return;
  await context.db.update(consignmentHold, { id: hold.id }).set({
    state: "reversalAbandoned",
    clearedAt: event.block.timestamp,
    updatedAt: event.block.timestamp,
  });
  // No cause push here: abandonReversal() pays the seller split via _paySplit,
  // which already emits ConsignmentSplitPaid — see module doc at top of file.
}

// ---------------------------------------------------------------------------
// BondedChallenge — shared between AscendingConsignment (ponder.on below) and
// KarPassport (exported functions called from src/index.ts's existing
// Challenge* handlers, since a single event can only be registered once).
// ---------------------------------------------------------------------------

async function writeChallengeOpened(
  instance: "passport" | "ascending",
  event: ChallengeOpenedEvent,
  context: CommerceContext,
): Promise<void> {
  const chainId = indexingChainId(context);
  const row = challengeOpenedRow({
    chainId,
    instance,
    instanceContract: event.log.address,
    subjectId: event.args.subjectId,
    challenger: event.args.challenger,
    bondAmount: event.args.bondAmount,
    windowDuration: event.args.windowDuration,
    openedAt: event.args.openedAt,
    txHash: event.transaction.hash,
    logIndex: event.log.logIndex,
    timestamp: event.block.timestamp,
  });
  await context.db.insert(challenge).values(row);
}

async function resolveChallengeTerminal(
  kind: "withdrawn" | "judged" | "concluded",
  event: ChallengeTerminalEvent,
  context: CommerceContext,
): Promise<{ id: string; bondRecipient: string } | null> {
  const chainId = indexingChainId(context);
  const open = await findOpenChallenge(context, chainId, event.log.address, event.args.subjectId);
  if (!open) return null;

  const bondRecipient =
    kind === "withdrawn"
      ? checksumOrZero(event.args.challenger)
      : checksumOrZero(event.args.bondRecipient ?? "");

  await context.db.update(challenge, { id: open.id }).set({
    status: kind,
    ...(kind === "judged"
      ? {
          judge: checksumOrZero(event.args.judge ?? ""),
          outcome: Number(event.args.outcome ?? 0),
        }
      : {}),
    bondRecipient,
    terminalAt: event.block.timestamp,
    terminalTxHash: event.transaction.hash.toLowerCase(),
    updatedAt: event.block.timestamp,
  });

  return { id: open.id, bondRecipient };
}

/** AscendingConsignment challenge terminals also feed the claim-cause correlator. */
async function handleAscendingChallengeTerminal(
  kind: "withdrawn" | "judged" | "concluded",
  eventName: "ChallengeWithdrawn" | "ChallengeJudged" | "ChallengeConcluded",
  event: ChallengeTerminalEvent,
  context: CommerceContext,
): Promise<void> {
  const result = await resolveChallengeTerminal(kind, event, context);
  if (!result) return;
  await pushCause(
    context,
    event.transaction.hash,
    causeFromChallengeTerminal({
      eventName,
      bondRecipient: result.bondRecipient,
      bondAmount: event.args.bondAmount,
      logIndex: event.log.logIndex,
    }),
  );
}

/**
 * KarPassport ADDITIVE writes — called from src/index.ts's existing
 * `KarPassport:ChallengeOpened` / `ChallengeWithdrawn` / `ChallengeJudged` /
 * `ChallengeConcluded` handlers. Do NOT register `ponder.on("KarPassport:Challenge*", …)`
 * here — those events are already owned by src/index.ts (one handler per
 * event per contract). Passport trust-field writes stay in src/index.ts
 * unchanged; this only maintains the shared `challenge` table row.
 *
 * No claim-cause push for KarPassport: its ClaimRecorded/ClaimWithdrawn are
 * indexed independently in src/index.ts via the legacy pending_claim /
 * claim_credit tables (role-based reason, not same-tx cause correlation).
 */
export async function indexPassportChallengeOpened(
  event: ChallengeOpenedEvent,
  context: CommerceContext,
): Promise<void> {
  await writeChallengeOpened("passport", event, context);
}

export async function indexPassportChallengeTerminal(
  kind: "withdrawn" | "judged" | "concluded",
  event: ChallengeTerminalEvent,
  context: CommerceContext,
): Promise<void> {
  await resolveChallengeTerminal(kind, event, context);
}

// ---------------------------------------------------------------------------
// Registrations
// ---------------------------------------------------------------------------

ponder.on("FixedPriceConsignment:ConsignmentOpened", async ({ event, context }) => {
  await handleConsignmentOpened(COMMERCE_MODE.FIXED_PRICE, event as ConsignmentOpenedEvent, context);
});
ponder.on("AscendingConsignment:ConsignmentOpened", async ({ event, context }) => {
  await handleConsignmentOpened(COMMERCE_MODE.ASCENDING, event as ConsignmentOpenedEvent, context);
});

ponder.on("FixedPriceConsignment:ConsignmentPriceSet", async ({ event, context }) => {
  await handleConsignmentPriceSet(event as ConsignmentPriceSetEvent, context);
});
ponder.on("AscendingConsignment:ConsignmentPriceSet", async ({ event, context }) => {
  await handleConsignmentPriceSet(event as ConsignmentPriceSetEvent, context);
});

ponder.on("FixedPriceConsignment:ConsignmentFloorLowered", async ({ event, context }) => {
  await handleConsignmentFloorLowered(event as FloorLoweredEvent, context);
});
ponder.on("AscendingConsignment:ConsignmentFloorLowered", async ({ event, context }) => {
  await handleConsignmentFloorLowered(event as FloorLoweredEvent, context);
});

ponder.on("FixedPriceConsignment:ConsignmentCommissionLowered", async ({ event, context }) => {
  await handleConsignmentCommissionLowered(event as CommissionLoweredEvent, context);
});
ponder.on("AscendingConsignment:ConsignmentCommissionLowered", async ({ event, context }) => {
  await handleConsignmentCommissionLowered(event as CommissionLoweredEvent, context);
});

ponder.on("FixedPriceConsignment:ConsignmentClosed", async ({ event, context }) => {
  await handleConsignmentClosed(event as ConsignmentClosedEvent, context);
});
ponder.on("AscendingConsignment:ConsignmentClosed", async ({ event, context }) => {
  await handleConsignmentClosed(event as ConsignmentClosedEvent, context);
});

ponder.on("FixedPriceConsignment:ConsignmentSplitPaid", async ({ event, context }) => {
  await handleConsignmentSplitPaid(event as ConsignmentSplitPaidEvent, context);
});
ponder.on("AscendingConsignment:ConsignmentSplitPaid", async ({ event, context }) => {
  await handleConsignmentSplitPaid(event as ConsignmentSplitPaidEvent, context);
});

ponder.on("FixedPriceConsignment:MandateGranted", async ({ event, context }) => {
  await handleMandateGranted(COMMERCE_MODE.FIXED_PRICE, event as MandateGrantedEvent, context);
});
ponder.on("AscendingConsignment:MandateGranted", async ({ event, context }) => {
  await handleMandateGranted(COMMERCE_MODE.ASCENDING, event as MandateGrantedEvent, context);
});

ponder.on("FixedPriceConsignment:MandateRevoked", async ({ event, context }) => {
  await handleMandateRevoked(event as MandateRevokedEvent, context);
});
ponder.on("AscendingConsignment:MandateRevoked", async ({ event, context }) => {
  await handleMandateRevoked(event as MandateRevokedEvent, context);
});

ponder.on("FixedPriceConsignment:RecallRequested", async ({ event, context }) => {
  await handleRecallRequested(event as RecallRequestedEvent, context);
});
ponder.on("AscendingConsignment:RecallRequested", async ({ event, context }) => {
  await handleRecallRequested(event as RecallRequestedEvent, context);
});

ponder.on("FixedPriceConsignment:Paused", async ({ event, context }) => {
  await handlePaused(COMMERCE_MODE.FIXED_PRICE, event as PausedEvent, context);
});
ponder.on("AscendingConsignment:Paused", async ({ event, context }) => {
  await handlePaused(COMMERCE_MODE.ASCENDING, event as PausedEvent, context);
});

ponder.on("FixedPriceConsignment:Unpaused", async ({ event, context }) => {
  await handleUnpaused(COMMERCE_MODE.FIXED_PRICE, event as PausedEvent, context);
});
ponder.on("AscendingConsignment:Unpaused", async ({ event, context }) => {
  await handleUnpaused(COMMERCE_MODE.ASCENDING, event as PausedEvent, context);
});

ponder.on("FixedPriceConsignment:GuardianSet", async ({ event, context }) => {
  await handleGuardianSet(COMMERCE_MODE.FIXED_PRICE, event as GuardianSetEvent, context);
});
ponder.on("AscendingConsignment:GuardianSet", async ({ event, context }) => {
  await handleGuardianSet(COMMERCE_MODE.ASCENDING, event as GuardianSetEvent, context);
});

ponder.on("FixedPriceConsignment:ClaimRecorded", async ({ event, context }) => {
  await handleCommerceClaimRecorded(event as ClaimEvent, context);
});
ponder.on("AscendingConsignment:ClaimRecorded", async ({ event, context }) => {
  await handleCommerceClaimRecorded(event as ClaimEvent, context);
});

ponder.on("FixedPriceConsignment:ClaimWithdrawn", async ({ event, context }) => {
  await handleCommerceClaimWithdrawn(event as ClaimEvent, context);
});
ponder.on("AscendingConsignment:ClaimWithdrawn", async ({ event, context }) => {
  await handleCommerceClaimWithdrawn(event as ClaimEvent, context);
});

// FixedPrice only.
ponder.on("FixedPriceConsignment:Bought", async ({ event, context }) => {
  await handleBought(event as BoughtEvent, context);
});
ponder.on("FixedPriceConsignment:ExternalPaymentConfirmed", async ({ event, context }) => {
  await handleExternalPaymentConfirmed(event as ExternalPaymentConfirmedEvent, context);
});
ponder.on("FixedPriceConsignment:SettlementNoteSet", async ({ event, context }) => {
  await handleSettlementNoteSet(event as SettlementNoteSetEvent, context);
});
ponder.on("FixedPriceConsignment:PaymentTokenApproved", async ({ event, context }) => {
  await handleFixedPricePaymentTokenApproved(event as FixedPricePaymentTokenApprovedEvent, context);
});
ponder.on("FixedPriceConsignment:PaymentTokenRevoked", async ({ event, context }) => {
  await handlePaymentTokenRevoked(event as PaymentTokenRevokedEvent, context);
});
ponder.on("FixedPriceConsignment:CurrencyFeedSet", async ({ event, context }) => {
  await handleCurrencyFeedSet(event as CurrencyFeedSetEvent, context);
});
ponder.on("FixedPriceConsignment:MaxFeedStalenessSet", async ({ event, context }) => {
  await handleMaxFeedStalenessSet(event as MaxFeedStalenessSetEvent, context);
});

// Ascending only.
ponder.on("AscendingConsignment:AuctionRulesSet", async ({ event, context }) => {
  await handleAuctionRulesSet(event as AuctionRulesSetEvent, context);
});
ponder.on("AscendingConsignment:PaymentTokenApproved", async ({ event, context }) => {
  await handleAscendingPaymentTokenApproved(event as AscendingPaymentTokenApprovedEvent, context);
});
ponder.on("AscendingConsignment:PaymentTokenRevoked", async ({ event, context }) => {
  await handlePaymentTokenRevoked(event as PaymentTokenRevokedEvent, context);
});
ponder.on("AscendingConsignment:AscendingTermsSnapshotted", async ({ event, context }) => {
  await handleAscendingTermsSnapshotted(event as AscendingTermsSnapshottedEvent, context);
});
ponder.on("AscendingConsignment:BidPlaced", async ({ event, context }) => {
  await handleBidPlaced(event as BidPlacedEvent, context);
});
ponder.on("AscendingConsignment:BidRefunded", async ({ event, context }) => {
  await handleBidRefunded(event as BidRefundedEvent, context);
});
ponder.on("AscendingConsignment:Settled", async ({ event, context }) => {
  await handleSettled(event as SettledEvent, context);
});
ponder.on("AscendingConsignment:ReceiptConfirmed", async ({ event, context }) => {
  await handleReceiptConfirmed(event as BuyerOnlyEvent, context);
});
ponder.on("AscendingConsignment:FundsReleased", async ({ event, context }) => {
  await handleFundsReleased(event as BuyerOnlyEvent, context);
});
ponder.on("AscendingConsignment:ReversalStarted", async ({ event, context }) => {
  await handleReversalStarted(event as ReversalStartedEvent, context);
});
ponder.on("AscendingConsignment:ReversalCompleted", async ({ event, context }) => {
  await handleReversalCompleted(event as BuyerOnlyEvent, context);
});
ponder.on("AscendingConsignment:ReversalAbandoned", async ({ event, context }) => {
  await handleReversalAbandoned(event as BuyerOnlyEvent, context);
});

ponder.on("AscendingConsignment:ChallengeOpened", async ({ event, context }) => {
  await writeChallengeOpened("ascending", event as ChallengeOpenedEvent, context);
});
ponder.on("AscendingConsignment:ChallengeWithdrawn", async ({ event, context }) => {
  await handleAscendingChallengeTerminal(
    "withdrawn",
    "ChallengeWithdrawn",
    event as ChallengeTerminalEvent,
    context,
  );
});
ponder.on("AscendingConsignment:ChallengeJudged", async ({ event, context }) => {
  await handleAscendingChallengeTerminal(
    "judged",
    "ChallengeJudged",
    event as ChallengeTerminalEvent,
    context,
  );
});
ponder.on("AscendingConsignment:ChallengeConcluded", async ({ event, context }) => {
  await handleAscendingChallengeTerminal(
    "concluded",
    "ChallengeConcluded",
    event as ChallengeTerminalEvent,
    context,
  );
});
