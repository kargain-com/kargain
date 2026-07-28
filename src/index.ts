import { ponder } from "ponder:registry";
import { and, eq } from "ponder";
import {
  agentAuthorization,
  auction,
  auctionAgentAuthorization,
  auctionBid,
  auctionSettlement,
  claimCredit,
  currencyFeed,
  marketplaceListing,
  marketplaceSale,
  passport,
  passportRecord,
  passportUriHistory,
  pendingClaim,
} from "ponder:schema";

import { getAddress } from "viem";

import { decodeCurrencyCode } from "../lib/marketplace/currency-code";
import { isDisputeWithdrawnRecord } from "../lib/passport/index-passport-metadata";
import {
  AUCTION_PHASE,
  auctionAgentAuthorizedRow,
  auctionCreatedRow,
  bidRowId,
  settlementDisputeOutcomeLabel,
} from "./lib/ponder-auction";
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
  agentAuthorizationId,
  authorizationDeactivatedPatch,
  authorizationTermsUpdatedPatch,
  marketplaceAgentAuthorizedRow,
  marketplaceAgentReauthorizedPatch,
} from "./lib/ponder-agent-authorization";
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

function currencyFeedId(chainId: number, currencyCode: string): string {
  return `${chainId}-${currencyCode}`;
}

/** Ponder 0.16 exposes the indexing network on `context.chain`, not `event.chain`. */
function indexingChainId(context: { chain: { id: number } }): number {
  return Number(context.chain.id);
}

/** Mirror `_clearAuctionStorage` silent auth delete — no-op when no row. */
async function deactivateAuctionAgentAuth(
  context: Parameters<Parameters<typeof ponder.on>[1]>[0]["context"],
  tokenId: string,
  updatedAt: bigint,
) {
  const row = await context.db.find(auctionAgentAuthorization, { id: tokenId });
  if (!row) return;
  await context.db.update(auctionAgentAuthorization, { id: tokenId }).set({
    active: false,
    updatedAt,
  });
}

/** Mirror the singleton on-chain authorization mapping across composite history rows. */
async function deactivateMarketplaceAgentAuths(
  context: Parameters<Parameters<typeof ponder.on>[1]>[0]["context"],
  tokenId: string,
  updatedAt: bigint,
) {
  const rows = await context.db.sql
    .select({ id: agentAuthorization.id })
    .from(agentAuthorization)
    .where(
      and(
        eq(agentAuthorization.tokenId, tokenId),
        eq(agentAuthorization.active, true),
      ),
    );
  for (const row of rows) {
    await context.db
      .update(agentAuthorization, { id: row.id })
      .set(authorizationDeactivatedPatch(updatedAt));
  }
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
    owner: event.args.to,
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
      owner: event.args.to,
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
      owner: event.args.to,
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
      disputeReason: event.args.reason,
      ...passportDisputedTrustFields(event.block.timestamp),
    });
});

ponder.on("KarPassport:DisputeResolved", async ({ event, context }) => {
  const uphold = disputeOutcomeUpholdsVerification(Number(event.args.outcome));
  await context.db
    .update(passport, { id: event.args.tokenId.toString() })
    .set(
      disputeResolvedTrustFields(
        uphold,
        event.block.timestamp,
        uphold ? "reject" : "confirm",
      ),
    );
});

ponder.on("KarPassport:DisputeExpired", async ({ event, context }) => {
  // Expiry lapses verification (UNVERIFIED) — not a merits Confirm.
  await context.db
    .update(passport, { id: event.args.tokenId.toString() })
    .set(disputeExpiredTrustFields(event.block.timestamp));
});

ponder.on("KarPassport:DisputeWithdrawn", async ({ event, context }) => {
  await context.db
    .update(passport, { id: event.args.tokenId.toString() })
    .set(disputeWithdrawnTrustFields(event.block.timestamp));
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
      owner: event.args.to,
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

ponder.on("MarketplaceEscrow:Listed", async ({ event, context }) => {
  const tokenId = event.args.tokenId.toString();
  const chainId = indexingChainId(context);
  const currencyCode = decodeCurrencyCode(event.args.currencyCode);
  const agent = event.args.agent.toLowerCase();
  const authId =
    agent !== ZERO_ADDRESS ? agentAuthorizationId(tokenId, agent) : null;
  const auth = authId ? await context.db.find(agentAuthorization, { id: authId }) : null;

  const listingValues = {
    id: tokenId,
    tokenId,
    chainId,
    seller: event.args.seller,
    fiatPrice1e8: event.args.fiatPrice1e8,
    currencyCode,
    agent: agent === ZERO_ADDRESS ? "" : event.args.agent,
    agentFeeBps: Number(event.args.agentFeeBps),
    ownerMinPrice1e8: auth?.ownerMinPrice1e8 ?? 0n,
    active: true,
    listedAt: event.block.timestamp,
    soldAt: 0n,
    buyer: "",
  };

  await context.db
    .insert(marketplaceListing)
    .values(listingValues)
    .onConflictDoUpdate({
      chainId: listingValues.chainId,
      seller: listingValues.seller,
      fiatPrice1e8: listingValues.fiatPrice1e8,
      currencyCode: listingValues.currencyCode,
      agent: listingValues.agent,
      agentFeeBps: listingValues.agentFeeBps,
      ownerMinPrice1e8: listingValues.ownerMinPrice1e8,
      active: true,
      listedAt: event.block.timestamp,
      soldAt: 0n,
      buyer: "",
    });
});

ponder.on("MarketplaceEscrow:ListingUpdated", async ({ event, context }) => {
  const tokenId = event.args.tokenId.toString();
  await context.db
    .update(marketplaceListing, { id: tokenId })
    .set({
      fiatPrice1e8: event.args.newPrice,
      agentFeeBps: Number(event.args.newAgentFeeBps),
    });
});

ponder.on("MarketplaceEscrow:Delisted", async ({ event, context }) => {
  const tokenId = event.args.tokenId.toString();
  const ts = event.block.timestamp;
  await context.db
    .update(marketplaceListing, { id: tokenId })
    .set({ active: false });
  await deactivateMarketplaceAgentAuths(context, tokenId, ts);
});

ponder.on("MarketplaceEscrow:AgentDelisted", async ({ event, context }) => {
  const tokenId = event.args.tokenId.toString();
  const ts = event.block.timestamp;
  await context.db
    .update(marketplaceListing, { id: tokenId })
    .set({ active: false });
  await deactivateMarketplaceAgentAuths(context, tokenId, ts);
});

ponder.on("MarketplaceEscrow:Sale", async ({ event, context }) => {
  const tokenId = event.args.tokenId.toString();
  const payToken =
    event.args.payToken === ZERO_ADDRESS ? "" : event.args.payToken;
  const agent =
    event.args.agent === ZERO_ADDRESS ? "" : event.args.agent;

  await context.db
    .update(marketplaceListing, { id: tokenId })
    .set({
      active: false,
      soldAt: event.block.timestamp,
      buyer: event.args.buyer,
    });

  await context.db.insert(marketplaceSale).values({
    id: `${tokenId}-${event.transaction.hash}`,
    tokenId,
    chainId: indexingChainId(context),
    buyer: event.args.buyer,
    seller: event.args.seller,
    gross: event.args.gross,
    platformFee: event.args.platformFee,
    agentFee: event.args.agentFee,
    netToSeller: event.args.netToSeller,
    payToken,
    agent,
    timestamp: event.block.timestamp,
  });
  await deactivateMarketplaceAgentAuths(
    context,
    tokenId,
    event.block.timestamp,
  );
});

ponder.on("MarketplaceEscrow:AgentAuthorized", async ({ event, context }) => {
  const tokenId = event.args.tokenId.toString();
  const ts = event.block.timestamp;
  const values = marketplaceAgentAuthorizedRow({
    tokenId,
    owner: event.args.owner,
    agent: event.args.agent,
    expiry: BigInt(event.args.expiry),
    ownerMinPrice1e8: event.args.ownerMinPrice1e8,
    timestamp: ts,
  });

  await deactivateMarketplaceAgentAuths(context, tokenId, ts);
  await context.db
    .insert(agentAuthorization)
    .values(values)
    .onConflictDoUpdate(marketplaceAgentReauthorizedPatch(values));
});

ponder.on("MarketplaceEscrow:AgentRevoked", async ({ event, context }) => {
  const tokenId = event.args.tokenId.toString();
  await deactivateMarketplaceAgentAuths(
    context,
    tokenId,
    event.block.timestamp,
  );
});

ponder.on("MarketplaceEscrow:OwnerMinPriceUpdated", async ({ event, context }) => {
  const tokenId = event.args.tokenId.toString();
  const listing = await context.db.find(marketplaceListing, { id: tokenId });
  if (listing?.agent) {
    const id = agentAuthorizationId(tokenId, listing.agent);
    await context.db
      .update(agentAuthorization, { id })
      .set(
        authorizationTermsUpdatedPatch(
          event.args.newMin,
          event.block.timestamp,
        ),
      );
  }
  await context.db
    .update(marketplaceListing, { id: tokenId })
    .set({ ownerMinPrice1e8: event.args.newMin });
});

ponder.on("MarketplaceEscrow:CurrencyFeedSet", async ({ event, context }) => {
  const currencyCode = decodeCurrencyCode(event.args.currencyCode);
  const chainId = indexingChainId(context);
  const id = currencyFeedId(chainId, currencyCode);

  await context.db
    .insert(currencyFeed)
    .values({
      id,
      chainId,
      currencyCode,
      feed: event.args.feed,
      registeredAt: event.block.timestamp,
      active: true,
    })
    .onConflictDoUpdate({
      chainId,
      currencyCode,
      feed: event.args.feed,
      registeredAt: event.block.timestamp,
      active: true,
    });
});

ponder.on("MarketplaceEscrow:CurrencyFeedRevoked", async ({ event, context }) => {
  const currencyCode = decodeCurrencyCode(event.args.currencyCode);
  const chainId = indexingChainId(context);
  const id = currencyFeedId(chainId, currencyCode);

  await context.db
    .update(currencyFeed, { id })
    .set({ active: false });
});

ponder.on("MarketplaceEscrow:ReturnRequested", async ({ event, context }) => {
  const tokenId = event.args.tokenId.toString();
  const listing = await context.db.find(marketplaceListing, { id: tokenId });
  if (listing?.active) {
    await context.db
      .update(marketplaceListing, { id: tokenId })
      .set({ returnRequestedAt: event.block.timestamp });
  }
});

ponder.on("MarketplaceEscrow:ForceReturn", async ({ event, context }) => {
  const tokenId = event.args.tokenId.toString();
  const ts = event.block.timestamp;
  await context.db
    .update(marketplaceListing, { id: tokenId })
    .set({ active: false });
  await deactivateMarketplaceAgentAuths(context, tokenId, ts);
});

ponder.on("MarketplaceEscrow:ExternalPaymentConfirmed", async ({ event, context }) => {
  const tokenId = event.args.tokenId.toString();
  await context.db
    .update(marketplaceListing, { id: tokenId })
    .set({
      active: false,
      externalPaymentConfirmedAt: event.block.timestamp,
    });
  await deactivateMarketplaceAgentAuths(
    context,
    tokenId,
    event.block.timestamp,
  );
});

ponder.on("MarketplaceEscrow:SettlementNoteSet", async () => {
  // Indexed only; note read via on-chain settlementNotes(tokenId) RPC.
});

ponder.on("MarketplaceEscrow:PaymentTokenApproved", async () => {});

ponder.on("MarketplaceEscrow:PaymentTokenRevoked", async () => {});

ponder.on("MarketplaceEscrow:Paused", async () => {});

ponder.on("KarPassport:DisputeDepositPaid", async ({ event, context }) => {
  await context.db
    .update(passport, { id: event.args.tokenId.toString() })
    .set({
      disputeDeposit: event.args.amount,
      updatedAt: event.block.timestamp,
    });
});

ponder.on("KarPassport:DisputeDepositUpdated", async () => {});

ponder.on("AuctionEscrow:AuctionAgentAuthorized", async ({ event, context }) => {
  const tokenId = event.args.tokenId.toString();
  const ts = event.block.timestamp;
  const values = auctionAgentAuthorizedRow({
    tokenId,
    owner: event.args.owner,
    agent: event.args.agent,
    expiry: BigInt(event.args.expiry),
    asset: event.args.asset,
    ownerMinAsset: BigInt(event.args.ownerMinAsset),
    createdAt: ts,
    updatedAt: ts,
    authorizedAt: ts,
  });

  await context.db
    .insert(auctionAgentAuthorization)
    .values(values)
    .onConflictDoUpdate({
      tokenId: values.tokenId,
      owner: values.owner,
      agent: values.agent,
      expiry: values.expiry,
      asset: values.asset,
      ownerMinAsset: values.ownerMinAsset,
      active: true,
      updatedAt: ts,
      authorizedAt: ts,
    });
});

ponder.on("AuctionEscrow:AuctionAgentRevoked", async ({ event, context }) => {
  await deactivateAuctionAgentAuth(
    context,
    event.args.tokenId.toString(),
    event.block.timestamp,
  );
});

ponder.on("AuctionEscrow:AuctionCreated", async ({ event, context }) => {
  const tokenId = event.args.tokenId.toString();
  const values = auctionCreatedRow({
    tokenId,
    chainId: indexingChainId(context),
    seller: event.args.seller,
    agent: event.args.agent,
    asset: event.args.asset,
    reserve: event.args.reserve,
    duration: BigInt(event.args.duration),
    agentFeeBps: Number(event.args.agentFeeBps),
    ownerMinAsset: 0n,
    timestamp: event.block.timestamp,
  });

  await context.db
    .insert(auction)
    .values(values)
    .onConflictDoUpdate({
      chainId: values.chainId,
      seller: values.seller,
      agent: values.agent,
      asset: values.asset,
      reserve: values.reserve,
      duration: values.duration,
      agentFeeBps: values.agentFeeBps,
      ownerMinAsset: values.ownerMinAsset,
      startedAt: 0n,
      endsAt: 0n,
      highestBidder: "",
      highestBid: 0n,
      active: true,
      phase: AUCTION_PHASE.CREATED,
      returnRequestedAt: null,
      createdAt: event.block.timestamp,
      updatedAt: event.block.timestamp,
    });
});

ponder.on("AuctionEscrow:AuctionStarted", async ({ event, context }) => {
  const tokenId = event.args.tokenId.toString();
  await context.db
    .update(auction, { id: tokenId })
    .set({
      startedAt: event.block.timestamp,
      endsAt: BigInt(event.args.endsAt),
      highestBidder: event.args.firstBidder,
      highestBid: event.args.amount,
      phase: AUCTION_PHASE.BIDDING,
      updatedAt: event.block.timestamp,
    });
});

ponder.on("AuctionEscrow:BidPlaced", async ({ event, context }) => {
  const tokenId = event.args.tokenId.toString();
  const bidId = bidRowId(event.transaction.hash, event.log.logIndex);

  await context.db
    .update(auction, { id: tokenId })
    .set({
      highestBidder: event.args.bidder,
      highestBid: event.args.amount,
      endsAt: BigInt(event.args.endsAt),
      phase: AUCTION_PHASE.BIDDING,
      updatedAt: event.block.timestamp,
    });

  await context.db.insert(auctionBid).values({
    id: bidId,
    tokenId,
    bidder: event.args.bidder,
    amount: event.args.amount,
    endsAt: BigInt(event.args.endsAt),
    refunded: false,
    timestamp: event.block.timestamp,
  });
});

ponder.on("AuctionEscrow:BidRefunded", async ({ event, context }) => {
  const tokenId = event.args.tokenId.toString();
  const bidder = event.args.bidder;
  const amount = event.args.amount;

  const bids = await context.db.sql
    .select()
    .from(auctionBid)
    .where(
      and(
        eq(auctionBid.tokenId, tokenId),
        eq(auctionBid.bidder, bidder),
        eq(auctionBid.amount, amount),
        eq(auctionBid.refunded, false),
      ),
    );

  for (const row of bids) {
    await context.db
      .update(auctionBid, { id: row.id })
      .set({
        refunded: true,
      });
  }
});

ponder.on("AuctionEscrow:AuctionCancelled", async ({ event, context }) => {
  const tokenId = event.args.tokenId.toString();
  const ts = event.block.timestamp;
  await context.db
    .update(auction, { id: tokenId })
    .set({
      active: false,
      phase: AUCTION_PHASE.CANCELLED,
      updatedAt: ts,
    });
  await deactivateAuctionAgentAuth(context, tokenId, ts);
});

ponder.on("AuctionEscrow:ReturnRequested", async ({ event, context }) => {
  const tokenId = event.args.tokenId.toString();
  await context.db
    .update(auction, { id: tokenId })
    .set({
      returnRequestedAt: event.block.timestamp,
      updatedAt: event.block.timestamp,
    });
});

ponder.on("AuctionEscrow:ForceReturn", async ({ event, context }) => {
  const tokenId = event.args.tokenId.toString();
  const ts = event.block.timestamp;
  await context.db
    .update(auction, { id: tokenId })
    .set({
      active: false,
      phase: AUCTION_PHASE.RETURNED,
      updatedAt: ts,
    });
  await deactivateAuctionAgentAuth(context, tokenId, ts);
});

ponder.on("AuctionEscrow:AuctionSettled", async ({ event, context }) => {
  const tokenId = event.args.tokenId.toString();
  const ts = event.block.timestamp;

  await context.db
    .update(auction, { id: tokenId })
    .set({
      active: false,
      phase: AUCTION_PHASE.SETTLED,
      updatedAt: ts,
    });

  const settlementValues = {
    id: tokenId,
    tokenId,
    buyer: event.args.buyer,
    gross: event.args.gross,
    releaseAt: BigInt(event.args.releaseAt),
    disputedAt: 0n,
    bond: null,
    disputeOutcome: "",
    receiptConfirmedAt: null,
    platformFee: null,
    agentFee: null,
    net: null,
    autoRelease: null,
    releasedAt: null,
    refundPendingAt: null,
    clearedAt: null,
    createdAt: ts,
    updatedAt: ts,
  };

  await context.db
    .insert(auctionSettlement)
    .values(settlementValues)
    .onConflictDoUpdate({
      buyer: settlementValues.buyer,
      gross: settlementValues.gross,
      releaseAt: settlementValues.releaseAt,
      disputedAt: 0n,
      bond: null,
      disputeOutcome: "",
      receiptConfirmedAt: null,
      platformFee: null,
      agentFee: null,
      net: null,
      autoRelease: null,
      releasedAt: null,
      refundPendingAt: null,
      clearedAt: null,
      updatedAt: ts,
    });
});

ponder.on("AuctionEscrow:ReceiptConfirmed", async ({ event, context }) => {
  const tokenId = event.args.tokenId.toString();
  await context.db
    .update(auctionSettlement, { id: tokenId })
    .set({
      receiptConfirmedAt: event.block.timestamp,
      updatedAt: event.block.timestamp,
    });
});

ponder.on("AuctionEscrow:FundsReleased", async ({ event, context }) => {
  const tokenId = event.args.tokenId.toString();
  const ts = event.block.timestamp;

  await context.db
    .update(auction, { id: tokenId })
    .set({
      phase: AUCTION_PHASE.RELEASED,
      updatedAt: ts,
    });

  await context.db
    .update(auctionSettlement, { id: tokenId })
    .set({
      platformFee: event.args.platformFee,
      agentFee: event.args.agentFee,
      net: event.args.net,
      autoRelease: event.args.autoRelease,
      releasedAt: ts,
      clearedAt: ts,
      updatedAt: ts,
    });

  await deactivateAuctionAgentAuth(context, tokenId, ts);
});

ponder.on("AuctionEscrow:SettlementDisputeOpened", async ({ event, context }) => {
  const tokenId = event.args.tokenId.toString();
  await context.db
    .update(auctionSettlement, { id: tokenId })
    .set({
      disputedAt: event.block.timestamp,
      bond: event.args.bond,
      updatedAt: event.block.timestamp,
    });
});

ponder.on("AuctionEscrow:SettlementDisputeResolved", async ({ event, context }) => {
  const tokenId = event.args.tokenId.toString();
  const outcome = settlementDisputeOutcomeLabel(Number(event.args.outcome));
  const patch: {
    disputeOutcome: string;
    updatedAt: bigint;
    refundPendingAt?: bigint;
  } = {
    disputeOutcome: outcome,
    updatedAt: event.block.timestamp,
  };
  if (outcome === "ConfirmFailure") {
    patch.refundPendingAt = event.block.timestamp;
  }
  await context.db.update(auctionSettlement, { id: tokenId }).set(patch);
});

ponder.on("AuctionEscrow:PassportReturnedAndRefunded", async ({ event, context }) => {
  const tokenId = event.args.tokenId.toString();
  const ts = event.block.timestamp;
  await context.db
    .update(auctionSettlement, { id: tokenId })
    .set({
      clearedAt: ts,
      updatedAt: ts,
    });
  await deactivateAuctionAgentAuth(context, tokenId, ts);
});

ponder.on("AuctionEscrow:AbandonedRefundClaimed", async ({ event, context }) => {
  const tokenId = event.args.tokenId.toString();
  const ts = event.block.timestamp;
  await context.db
    .update(auctionSettlement, { id: tokenId })
    .set({
      clearedAt: ts,
      updatedAt: ts,
    });
});

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

ponder.on("AuctionEscrow:ClaimRecorded", async ({ event, context }) => {
  await handleClaimRecorded(event as ClaimHandlerEvent, context, "auction");
});
ponder.on("MarketplaceEscrow:ClaimRecorded", async ({ event, context }) => {
  await handleClaimRecorded(event as ClaimHandlerEvent, context, "marketplace");
});
ponder.on("KarPassport:ClaimRecorded", async ({ event, context }) => {
  await handleClaimRecorded(event as ClaimHandlerEvent, context, "passport");
});
ponder.on("KarProStaking:ClaimRecorded", async ({ event, context }) => {
  await handleClaimRecorded(event as ClaimHandlerEvent, context, "staking");
});

ponder.on("AuctionEscrow:ClaimWithdrawn", async ({ event, context }) => {
  await handleClaimWithdrawn(event as ClaimHandlerEvent, context);
});
ponder.on("MarketplaceEscrow:ClaimWithdrawn", async ({ event, context }) => {
  await handleClaimWithdrawn(event as ClaimHandlerEvent, context);
});
ponder.on("KarPassport:ClaimWithdrawn", async ({ event, context }) => {
  await handleClaimWithdrawn(event as ClaimHandlerEvent, context);
});
ponder.on("KarProStaking:ClaimWithdrawn", async ({ event, context }) => {
  await handleClaimWithdrawn(event as ClaimHandlerEvent, context);
});
