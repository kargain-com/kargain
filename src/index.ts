import { ponder } from "ponder:registry";
import {
  claimCredit,
  passport,
  passportRecord,
  passportUriHistory,
  pendingClaim,
} from "ponder:schema";

import { getAddress } from "viem";

import { isDisputeWithdrawnRecord } from "../lib/passport/index-passport-metadata";
// Additive KarPassport `challenge` table writes — registers FixedPriceConsignment /
// AscendingConsignment handlers as a side effect. Passport trust-field writes
// (below) are NOT touched by this import; see src/commerce-handlers.ts module doc.
import {
  indexPassportChallengeOpened,
  indexPassportChallengeTerminal,
} from "./commerce-handlers";
import {
  bridgeMintArrivalTrustFields,
  disputeExpiredTrustFields,
  disputeOutcomeUpholdsVerification,
  disputeResolvedTrustFields,
  disputeWithdrawnTrustFields,
  passportDisputedTrustFields,
  passportMintTrustFields,
  passportUriUpdatedTrustFields,
  verificationResetTrustFields,
} from "./lib/ponder-g1-fields";
import {
  nextCustodyChain,
  originChainIdOf,
  resolveCustody,
} from "./lib/ponder-custody";
import {
  indexPassportMetadataFromUri,
} from "./lib/ponder-passport-metadata";
import { indexKarProMetadataFromUri } from "./lib/ponder-kar-pro-metadata";
import {
  normalizeVerifierId,
  patchVerifierIfExists,
  proPassBurnedPatch,
  proPassProfilePatch,
  upsertVerifierFromProPassMint,
  upsertVerifierFromStakingJoin,
  verificationFeePatch,
  verifierLeftPatch,
} from "./lib/ponder-verifier-lifecycle";
import {
  claimRecordedCreditRow,
  pendingClaimAfterCredit,
  pendingClaimAfterWithdraw,
} from "./lib/ponder-claims";
import type { ClaimableContractRole } from "../lib/web3/claimable-contracts";
import { pendingClaimId } from "../lib/claims/ids";

const ZERO_ADDRESS =
  "0x0000000000000000000000000000000000000000" as const;

/** Ponder 0.16 exposes the indexing network on `context.chain`, not `event.chain`. */
function indexingChainId(context: { chain: { id: number } }): number {
  return Number(context.chain.id);
}

async function appendUriHistory(
  context: Parameters<Parameters<typeof ponder.on>[1]>[0]["context"],
  params: {
    tokenId: string;
    chainId: number;
    previousUri: string;
    newUri: string;
    author: string;
    verificationReset: boolean;
    timestamp: bigint;
    historyId: string;
  },
): Promise<void> {
  await context.db.insert(passportUriHistory).values({
    id: params.historyId,
    tokenId: params.tokenId,
    chainId: params.chainId,
    previousUri: params.previousUri,
    newUri: params.newUri,
    author: params.author,
    verificationReset: params.verificationReset,
    timestamp: params.timestamp,
  });
}

ponder.on("KarPassport:PassportMinted", async ({ event, context }) => {
  const tokenId = event.args.tokenId.toString();
  const uri = event.args.uri;
  const origin = originChainIdOf(event.args.tokenId);
  const chainId = indexingChainId(context);
  const ts = event.block.timestamp;
  const custodyChain =
    nextCustodyChain(undefined, {
      kind: "native-mint",
      eventChainId: chainId,
      tokenId: event.args.tokenId,
    }) ?? origin;
  const custody =
    resolveCustody(undefined, custodyChain, ts) ?? {
      custodyChain,
      custodyUpdatedAt: ts,
    };

  await context.db.insert(passport).values({
    id: tokenId,
    chainId: origin,
    custodyChain: custody.custodyChain,
    custodyUpdatedAt: custody.custodyUpdatedAt,
    owner: getAddress(event.args.to),
    status: "UNVERIFIED",
    verifier: "",
    verifiedAt: 0n,
    tokenUri: uri,
    ...passportMintTrustFields(ts),
  });

  await appendUriHistory(context, {
    tokenId,
    chainId,
    previousUri: "",
    newUri: uri,
    author: event.args.to,
    verificationReset: false,
    timestamp: ts,
    historyId: `${event.transaction.hash}-${event.log.logIndex}`,
  });

  await indexPassportMetadataFromUri(context, tokenId, uri, ts);
});

ponder.on("KarPassport:PassportBridgeMinted", async ({ event, context }) => {
  const tokenId = event.args.tokenId.toString();
  const uri = event.args.uri;
  const origin = originChainIdOf(event.args.tokenId);
  const chainId = indexingChainId(context);
  const candidate =
    nextCustodyChain(undefined, {
      kind: "bridge-mint",
      eventChainId: chainId,
    }) ?? chainId;
  const ts = event.block.timestamp;
  const trust = passportMintTrustFields(ts);

  const existing = await context.db.find(passport, { id: tokenId });
  const custody = resolveCustody(
    existing
      ? {
          custodyChain: existing.custodyChain,
          custodyUpdatedAt: existing.custodyUpdatedAt,
        }
      : undefined,
    candidate,
    ts,
  );

  if (existing) {
    await context.db.update(passport, { id: tokenId }).set({
      ...(custody
        ? {
            custodyChain: custody.custodyChain,
            custodyUpdatedAt: custody.custodyUpdatedAt,
          }
        : {}),
      owner: getAddress(event.args.to),
      tokenUri: uri,
      ...bridgeMintArrivalTrustFields(ts),
    });
  } else {
    const initial =
      custody ??
      ({ custodyChain: candidate, custodyUpdatedAt: ts } as const);
    await context.db.insert(passport).values({
      id: tokenId,
      chainId: origin,
      custodyChain: initial.custodyChain,
      custodyUpdatedAt: initial.custodyUpdatedAt,
      owner: getAddress(event.args.to),
      status: "UNVERIFIED",
      verifier: "",
      verifiedAt: 0n,
      tokenUri: uri,
      ...trust,
    });
  }

  await appendUriHistory(context, {
    tokenId,
    chainId,
    previousUri: existing?.tokenUri ?? "",
    newUri: uri,
    author: event.args.to,
    verificationReset: false,
    timestamp: ts,
    historyId: `${event.transaction.hash}-${event.log.logIndex}`,
  });

  await indexPassportMetadataFromUri(context, tokenId, uri, ts);
});

ponder.on("KarPassport:PassportBridgeBurned", async () => {
  // Token left this network. Do not recalculate custodyChain —
  // destination PassportBridgeMinted owns the update (SPEC §I.12.8).
});

ponder.on("KarPassport:CustodyLockSet", async ({ event, context }) => {
  if (event.args.locked) return;
  const tokenId = event.args.tokenId.toString();
  const chainId = indexingChainId(context);
  const candidate = nextCustodyChain(undefined, {
    kind: "custody-unlock",
    eventChainId: chainId,
  });
  if (candidate === undefined) return;

  const existing = await context.db.find(passport, { id: tokenId });
  const ts = event.block.timestamp;
  const custody = resolveCustody(
    existing
      ? {
          custodyChain: existing.custodyChain,
          custodyUpdatedAt: existing.custodyUpdatedAt,
        }
      : undefined,
    candidate,
    ts,
  );
  if (custody === null) return;

  await context.db.update(passport, { id: tokenId }).set({
    custodyChain: custody.custodyChain,
    custodyUpdatedAt: custody.custodyUpdatedAt,
    updatedAt: ts,
  });
});

ponder.on("KarPassport:PassportVerified", async ({ event, context }) => {
  await context.db
    .update(passport, { id: event.args.tokenId.toString() })
    .set({
      status: "VERIFIED",
      verifier: getAddress(event.args.verifier),
      verifiedAt: event.block.timestamp,
      updatedAt: event.block.timestamp,
    });
});

ponder.on("KarPassport:PassportDisputed", async ({ event, context }) => {
  await context.db
    .update(passport, { id: event.args.tokenId.toString() })
    .set({
      lastDisputer: event.args.disputer,
      disputeReason: "",
      ...passportDisputedTrustFields(event.block.timestamp),
    });
});

ponder.on("KarPassport:ChallengeOpened", async ({ event, context }) => {
  await context.db
    .update(passport, { id: event.args.subjectId.toString() })
    .set({
      disputeDeposit: event.args.bondAmount,
      updatedAt: event.block.timestamp,
    });
  // Additive — shared `challenge` table row (src/commerce-handlers.ts).
  await indexPassportChallengeOpened(event, context);
});

ponder.on("KarPassport:ChallengeJudged", async ({ event, context }) => {
  const uphold = disputeOutcomeUpholdsVerification(Number(event.args.outcome));
  await context.db
    .update(passport, { id: event.args.subjectId.toString() })
    .set(
      disputeResolvedTrustFields(
        uphold,
        event.block.timestamp,
        uphold ? "reject" : "confirm",
      ),
    );
  // Additive — shared `challenge` table row (src/commerce-handlers.ts).
  await indexPassportChallengeTerminal("judged", event, context);
});

ponder.on("KarPassport:ChallengeConcluded", async ({ event, context }) => {
  // Expiry lapses verification (UNVERIFIED) — not a merits Confirm.
  await context.db
    .update(passport, { id: event.args.subjectId.toString() })
    .set(disputeExpiredTrustFields(event.block.timestamp));
  // Additive — shared `challenge` table row (src/commerce-handlers.ts).
  await indexPassportChallengeTerminal("concluded", event, context);
});

ponder.on("KarPassport:ChallengeWithdrawn", async ({ event, context }) => {
  await context.db
    .update(passport, { id: event.args.subjectId.toString() })
    .set(disputeWithdrawnTrustFields(event.block.timestamp));
  // Additive — shared `challenge` table row (src/commerce-handlers.ts).
  await indexPassportChallengeTerminal("withdrawn", event, context);
});

ponder.on("KarPassport:VerificationReset", async ({ event, context }) => {
  const tokenId = event.args.tokenId.toString();
  const existing = await context.db.find(passport, { id: tokenId });
  const origin = existing?.chainId ?? originChainIdOf(event.args.tokenId);
  const chainId = indexingChainId(context);
  // Unlock-on-home emits VerificationReset; set custody to home when event is on origin.
  const custodyPatch =
    chainId === origin
      ? {
          custodyChain:
            nextCustodyChain(existing?.custodyChain, {
              kind: "verification-reset-home",
              eventChainId: chainId,
              originChainId: origin,
            }) ?? origin,
        }
      : {};
  await context.db
    .update(passport, { id: tokenId })
    .set({
      ...verificationResetTrustFields(
        existing?.verificationResetCount ?? 0,
        event.block.timestamp,
      ),
      ...custodyPatch,
    });
});

ponder.on("KarPassport:PassportURIUpdated", async ({ event, context }) => {
  const tokenId = event.args.tokenId.toString();
  const existing = await context.db.find(passport, { id: tokenId });
  const previousUri = existing?.tokenUri ?? "";
  const chainId = indexingChainId(context);

  const verificationReset =
    existing != null &&
    existing.lastVerificationResetAt === event.block.timestamp;

  await context.db
    .update(passport, { id: tokenId })
    .set({
      tokenUri: event.args.newURI,
      ...passportUriUpdatedTrustFields(event.block.timestamp),
    });

  await appendUriHistory(context, {
    tokenId,
    chainId,
    previousUri,
    newUri: event.args.newURI,
    author: event.args.author,
    verificationReset,
    timestamp: event.block.timestamp,
    historyId: `${event.transaction.hash}-${event.log.logIndex}`,
  });

  await indexPassportMetadataFromUri(
    context,
    tokenId,
    event.args.newURI,
    event.block.timestamp,
  );
});

ponder.on("KarPassport:RecordAppended", async ({ event, context }) => {
  const tokenId = event.args.tokenId.toString();
  await context.db.insert(passportRecord).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    tokenId,
    chainId: indexingChainId(context),
    author: event.args.author,
    recordType: event.args.recordType,
    description: event.args.description,
    evidenceCID: event.args.evidenceCID,
    timestamp: event.block.timestamp,
  });

  const row = await context.db.find(passport, { id: tokenId });
  if (
    row &&
    isDisputeWithdrawnRecord(
      event.args.recordType,
      event.args.description,
      event.args.author,
      row.lastDisputer,
    )
  ) {
    await context.db.update(passport, { id: tokenId }).set({
      disputeWithdrawnAt: event.block.timestamp,
      disputeOpenedAt: 0n,
      disputeDeposit: null,
      updatedAt: event.block.timestamp,
    });
  }
});

ponder.on("KarPassport:Transfer", async ({ event, context }) => {
  if (event.args.from === ZERO_ADDRESS) {
    return;
  }
  await context.db
    .update(passport, { id: event.args.tokenId.toString() })
    .set({
      owner: getAddress(event.args.to),
      updatedAt: event.block.timestamp,
    });
});

ponder.on("KarProStaking:VerifierJoined", async ({ event, context }) => {
  await upsertVerifierFromStakingJoin(
    context.db,
    indexingChainId(context),
    event.args.verifier,
    event.args.asset,
    event.args.amount,
    event.block.timestamp,
  );
});

ponder.on("KarProStaking:VerifierLeft", async ({ event, context }) => {
  await patchVerifierIfExists(
    context.db,
    normalizeVerifierId(indexingChainId(context), event.args.verifier),
    verifierLeftPatch(event.block.timestamp),
  );
});

ponder.on("KarProStaking:VerificationFeeUpdated", async ({ event, context }) => {
  await patchVerifierIfExists(
    context.db,
    normalizeVerifierId(indexingChainId(context), event.args.verifier),
    verificationFeePatch(event.args.fee),
  );
});

ponder.on("KarProPass:ProPassMinted", async ({ event, context }) => {
  const indexed = await indexKarProMetadataFromUri(event.args.metadataURI);
  await upsertVerifierFromProPassMint(
    context.db,
    indexingChainId(context),
    event.args.holder,
    Number(event.args.category),
    event.args.name,
    event.args.metadataURI,
    indexed,
  );
});

ponder.on("KarProPass:ProfileUpdated", async ({ event, context }) => {
  const indexed = await indexKarProMetadataFromUri(event.args.metadataURI);
  await patchVerifierIfExists(
    context.db,
    normalizeVerifierId(indexingChainId(context), event.args.holder),
    proPassProfilePatch(
      Number(event.args.category),
      event.args.name,
      event.args.metadataURI,
      indexed.slug,
      {
        locationLabel: indexed.locationLabel,
        locationPlaceId: indexed.locationPlaceId,
        locationCountryCode: indexed.locationCountryCode,
      },
    ),
  );
});

ponder.on("KarProPass:ProPassBurned", async ({ event, context }) => {
  await patchVerifierIfExists(
    context.db,
    normalizeVerifierId(indexingChainId(context), event.args.holder),
    proPassBurnedPatch(),
  );
});

ponder.on("KarPassport:DisputeDepositUpdated", async () => {});

type ClaimHandlerContext = Parameters<Parameters<typeof ponder.on>[1]>[0]["context"];
type ClaimHandlerEvent = {
  args: { account: `0x${string}`; asset: `0x${string}`; amount: bigint };
  log: { address: `0x${string}`; logIndex: number };
  block: { timestamp: bigint };
  transaction: { hash: `0x${string}`; input?: `0x${string}` };
};

async function handleClaimRecorded(
  event: ClaimHandlerEvent,
  context: ClaimHandlerContext,
  role: ClaimableContractRole,
) {
  const chainId = indexingChainId(context);
  const credit = claimRecordedCreditRow({
    chainId,
    contract: event.log.address,
    account: event.args.account,
    asset: event.args.asset,
    amount: event.args.amount,
    role,
    txInput: event.transaction.input,
    txHash: event.transaction.hash,
    logIndex: event.log.logIndex,
    timestamp: event.block.timestamp,
  });

  await context.db
    .insert(claimCredit)
    .values(credit)
    .onConflictDoUpdate({
      amount: credit.amount,
      reasonCode: credit.reasonCode,
      timestamp: credit.timestamp,
    });

  const balanceId = pendingClaimId({
    chainId: credit.chainId,
    contract: credit.contract,
    account: credit.account,
    asset: credit.asset,
  });
  const prior = await context.db.find(pendingClaim, { id: balanceId });
  const next = pendingClaimAfterCredit({
    existing: prior
      ? {
          id: prior.id,
          chainId: prior.chainId,
          contract: prior.contract,
          account: prior.account,
          asset: prior.asset,
          amount: prior.amount,
          reasonCode: prior.reasonCode,
          updatedAt: prior.updatedAt,
          firstCreditedAt: prior.firstCreditedAt,
        }
      : null,
    credit,
  });

  await context.db
    .insert(pendingClaim)
    .values(next)
    .onConflictDoUpdate({
      amount: next.amount,
      reasonCode: next.reasonCode,
      updatedAt: next.updatedAt,
    });
}

async function handleClaimWithdrawn(
  event: ClaimHandlerEvent,
  context: ClaimHandlerContext,
) {
  const chainId = indexingChainId(context);
  const contract = getAddress(event.log.address);
  const account = getAddress(event.args.account);
  const asset =
    !event.args.asset || /^0x0+$/i.test(event.args.asset)
      ? ZERO_ADDRESS
      : getAddress(event.args.asset);
  const balanceId = pendingClaimId({ chainId, contract, account, asset });
  const prior = await context.db.find(pendingClaim, { id: balanceId });
  if (!prior) return;
  const next = pendingClaimAfterWithdraw({
    existing: {
      id: prior.id,
      chainId: prior.chainId,
      contract: prior.contract,
      account: prior.account,
      asset: prior.asset,
      amount: prior.amount,
      reasonCode: prior.reasonCode,
      updatedAt: prior.updatedAt,
      firstCreditedAt: prior.firstCreditedAt,
    },
    timestamp: event.block.timestamp,
  });
  await context.db.update(pendingClaim, { id: balanceId }).set({
    amount: next.amount,
    updatedAt: next.updatedAt,
  });
}

ponder.on("KarPassport:ClaimRecorded", async ({ event, context }) => {
  await handleClaimRecorded(event as ClaimHandlerEvent, context, "passport");
});
ponder.on("KarProStaking:ClaimRecorded", async ({ event, context }) => {
  await handleClaimRecorded(event as ClaimHandlerEvent, context, "staking");
});

ponder.on("KarPassport:ClaimWithdrawn", async ({ event, context }) => {
  await handleClaimWithdrawn(event as ClaimHandlerEvent, context);
});
ponder.on("KarProStaking:ClaimWithdrawn", async ({ event, context }) => {
  await handleClaimWithdrawn(event as ClaimHandlerEvent, context);
});
