import { ponder } from "ponder:registry";
import {
  agentAuthorization,
  currencyFeed,
  marketplaceListing,
  marketplaceSale,
  passport,
  passportRecord,
  passportUriHistory,
} from "ponder:schema";

import { getAddress } from "viem";

import { decodeCurrencyCode } from "../lib/marketplace/currency-code";
import { isDisputeWithdrawnRecord } from "../lib/passport/index-passport-metadata";
import {
  disputeOutcomeUpholdsVerification,
  disputeResolvedTrustFields,
  disputeWithdrawnTrustFields,
  passportDisputedTrustFields,
  passportMintTrustFields,
  passportUriUpdatedTrustFields,
  verificationResetTrustFields,
} from "./lib/ponder-g1-fields";
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

const ZERO_ADDRESS =
  "0x0000000000000000000000000000000000000000" as const;

function agentAuthId(tokenId: string, agent: string): string {
  return `${tokenId}-${agent.toLowerCase()}`;
}

function currencyFeedId(chainId: number, currencyCode: string): string {
  return `${chainId}-${currencyCode}`;
}

async function appendUriHistory(
  context: Parameters<Parameters<typeof ponder.on>[1]>[0]["context"],
  params: {
    tokenId: string;
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

  await context.db.insert(passport).values({
    id: tokenId,
    owner: event.args.to,
    status: "UNVERIFIED",
    verifier: "",
    verifiedAt: 0n,
    tokenUri: uri,
    ...passportMintTrustFields(event.block.timestamp),
  });

  await appendUriHistory(context, {
    tokenId,
    previousUri: "",
    newUri: uri,
    author: event.args.to,
    verificationReset: false,
    timestamp: event.block.timestamp,
    historyId: `${event.transaction.hash}-${event.log.logIndex}`,
  });

  await indexPassportMetadataFromUri(context, tokenId, uri, event.block.timestamp);
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
    .set(disputeResolvedTrustFields(uphold, event.block.timestamp));
});

ponder.on("KarPassport:DisputeWithdrawn", async ({ event, context }) => {
  await context.db
    .update(passport, { id: event.args.tokenId.toString() })
    .set(disputeWithdrawnTrustFields(event.block.timestamp));
});

ponder.on("KarPassport:VerificationReset", async ({ event, context }) => {
  const tokenId = event.args.tokenId.toString();
  const existing = await context.db.find(passport, { id: tokenId });
  await context.db
    .update(passport, { id: tokenId })
    .set(verificationResetTrustFields(existing?.verificationResetCount ?? 0, event.block.timestamp));
});

ponder.on("KarPassport:PassportURIUpdated", async ({ event, context }) => {
  const tokenId = event.args.tokenId.toString();
  const existing = await context.db.find(passport, { id: tokenId });
  const previousUri = existing?.tokenUri ?? "";

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
    event.args.verifier,
    Number(event.args.asset),
    event.args.amount,
    event.block.timestamp,
  );
});

ponder.on("KarProStaking:VerifierLeft", async ({ event, context }) => {
  await patchVerifierIfExists(
    context.db,
    normalizeVerifierId(event.args.verifier),
    verifierLeftPatch(event.block.timestamp),
  );
});

ponder.on("KarProStaking:VerificationFeeUpdated", async ({ event, context }) => {
  await patchVerifierIfExists(
    context.db,
    normalizeVerifierId(event.args.verifier),
    verificationFeePatch(event.args.fee),
  );
});

ponder.on("KarProPass:ProPassMinted", async ({ event, context }) => {
  const { slug } = await indexKarProMetadataFromUri(event.args.metadataURI);
  await upsertVerifierFromProPassMint(
    context.db,
    event.args.holder,
    Number(event.args.category),
    event.args.name,
    event.args.metadataURI,
    slug,
  );
});

ponder.on("KarProPass:ProfileUpdated", async ({ event, context }) => {
  const { slug } = await indexKarProMetadataFromUri(event.args.metadataURI);
  await patchVerifierIfExists(
    context.db,
    normalizeVerifierId(event.args.holder),
    proPassProfilePatch(
      Number(event.args.category),
      event.args.name,
      event.args.metadataURI,
      slug,
    ),
  );
});

ponder.on("KarProPass:ProPassBurned", async ({ event, context }) => {
  await patchVerifierIfExists(
    context.db,
    normalizeVerifierId(event.args.holder),
    proPassBurnedPatch(),
  );
});

ponder.on("MarketplaceEscrow:Listed", async ({ event, context }) => {
  const tokenId = event.args.tokenId.toString();
  const currencyCode = decodeCurrencyCode(event.args.currencyCode);
  const agent = event.args.agent.toLowerCase();
  const authId = agent !== ZERO_ADDRESS ? agentAuthId(tokenId, agent) : null;
  const auth = authId ? await context.db.find(agentAuthorization, { id: authId }) : null;

  const listingValues = {
    id: tokenId,
    tokenId,
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
  await context.db
    .update(marketplaceListing, { id: event.args.tokenId.toString() })
    .set({ active: false });
});

ponder.on("MarketplaceEscrow:AgentDelisted", async ({ event, context }) => {
  await context.db
    .update(marketplaceListing, { id: event.args.tokenId.toString() })
    .set({ active: false });
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
});

ponder.on("MarketplaceEscrow:AgentAuthorized", async ({ event, context }) => {
  const tokenId = event.args.tokenId.toString();
  const agent = event.args.agent;
  const id = agentAuthId(tokenId, agent);

  await context.db
    .insert(agentAuthorization)
    .values({
      id,
      tokenId,
      agent,
      expiry: BigInt(event.args.expiry),
      ownerMinPrice1e8: event.args.ownerMinPrice1e8,
      active: true,
    })
    .onConflictDoUpdate({
      tokenId,
      agent,
      expiry: BigInt(event.args.expiry),
      ownerMinPrice1e8: event.args.ownerMinPrice1e8,
      active: true,
    });
});

ponder.on("MarketplaceEscrow:AgentRevoked", async ({ event, context }) => {
  const tokenId = event.args.tokenId.toString();
  const agent = event.args.agent;
  const id = agentAuthId(tokenId, agent);

  await context.db
    .update(agentAuthorization, { id })
    .set({ active: false });

  const listing = await context.db.find(marketplaceListing, { id: tokenId });
  if (listing && listing.agent.toLowerCase() === agent.toLowerCase()) {
    await context.db
      .update(marketplaceListing, { id: tokenId })
      .set({ agent: "" });
  }
});

ponder.on("MarketplaceEscrow:OwnerMinPriceUpdated", async ({ event, context }) => {
  const tokenId = event.args.tokenId.toString();
  const listing = await context.db.find(marketplaceListing, { id: tokenId });
  if (listing?.agent) {
    const id = agentAuthId(tokenId, listing.agent);
    await context.db
      .update(agentAuthorization, { id })
      .set({ ownerMinPrice1e8: event.args.newMin });
  }
  await context.db
    .update(marketplaceListing, { id: tokenId })
    .set({ ownerMinPrice1e8: event.args.newMin });
});

ponder.on("MarketplaceEscrow:CurrencyFeedSet", async ({ event, context }) => {
  const currencyCode = decodeCurrencyCode(event.args.currencyCode);
  const chainId = Number(event.chain.id);
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
  const chainId = Number(event.chain.id);
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
  await context.db
    .update(marketplaceListing, { id: event.args.tokenId.toString() })
    .set({ active: false });
});

ponder.on("MarketplaceEscrow:ExternalPaymentConfirmed", async ({ event, context }) => {
  const tokenId = event.args.tokenId.toString();
  await context.db
    .update(marketplaceListing, { id: tokenId })
    .set({
      active: false,
      externalPaymentConfirmedAt: event.block.timestamp,
    });
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
