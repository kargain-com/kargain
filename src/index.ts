import { ponder } from "ponder:registry";
import {
  marketplaceListing,
  marketplaceSale,
  passport,
  passportRecord,
  passportUriHistory,
  verifier,
} from "ponder:schema";

import { isDisputeWithdrawnRecord } from "../lib/passport/index-passport-metadata";
import {
  disputeResolvedTrustFields,
  passportDisputedTrustFields,
  passportMintTrustFields,
  passportUriUpdatedTrustFields,
  verificationResetTrustFields,
} from "./lib/ponder-g1-fields";
import {
  indexPassportMetadataFromUri,
} from "./lib/ponder-passport-metadata";
import { indexKarProMetadataFromUri } from "./lib/ponder-kar-pro-metadata";

const ZERO_ADDRESS =
  "0x0000000000000000000000000000000000000000" as const;

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
      verifier: event.args.verifier,
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
  await context.db
    .update(passport, { id: event.args.tokenId.toString() })
    .set(disputeResolvedTrustFields(event.args.uphold, event.block.timestamp));
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
  const id = event.args.verifier.toLowerCase();
  await context.db
    .insert(verifier)
    .values({
      id,
      address: event.args.verifier,
      stakeAsset: Number(event.args.asset),
      stakeAmount: event.args.amount.toString(),
      active: true,
      joinedAt: event.block.timestamp,
    })
    .onConflictDoUpdate({
      address: event.args.verifier,
      stakeAsset: Number(event.args.asset),
      stakeAmount: event.args.amount.toString(),
      active: true,
      joinedAt: event.block.timestamp,
    });
});

ponder.on("KarProStaking:VerifierLeft", async ({ event, context }) => {
  await context.db
    .update(verifier, { id: event.args.verifier.toLowerCase() })
    .set({
      active: false,
      stakeAmount: "0",
      leftAt: event.block.timestamp,
    });
});

ponder.on("KarProPass:ProPassMinted", async ({ event, context }) => {
  const id = event.args.holder.toLowerCase();
  const { slug } = await indexKarProMetadataFromUri(event.args.metadataURI);
  await context.db
    .insert(verifier)
    .values({
      id,
      address: event.args.holder,
      category: Number(event.args.category),
      name: event.args.name,
      slug,
      metadataURI: event.args.metadataURI,
      active: true,
    })
    .onConflictDoUpdate({
      address: event.args.holder,
      category: Number(event.args.category),
      name: event.args.name,
      slug,
      metadataURI: event.args.metadataURI,
      active: true,
    });
});

ponder.on("KarProPass:ProfileUpdated", async ({ event, context }) => {
  const { slug } = await indexKarProMetadataFromUri(event.args.metadataURI);
  await context.db
    .update(verifier, { id: event.args.holder.toLowerCase() })
    .set({
      category: Number(event.args.category),
      name: event.args.name,
      slug,
      metadataURI: event.args.metadataURI,
    });
});

ponder.on("KarProPass:ProPassBurned", async ({ event, context }) => {
  await context.db
    .update(verifier, { id: event.args.holder.toLowerCase() })
    .set({ active: false });
});

ponder.on("MarketplaceEscrow:Listed", async ({ event, context }) => {
  const tokenId = event.args.tokenId.toString();
  await context.db
    .insert(marketplaceListing)
    .values({
      id: tokenId,
      tokenId,
      seller: event.args.seller,
      fiatPrice1e8: event.args.fiatPrice1e8,
      fiatCurrency: event.args.fiatCurrency,
      active: true,
      listedAt: event.block.timestamp,
      soldAt: 0n,
      buyer: "",
    })
    .onConflictDoUpdate({
      seller: event.args.seller,
      fiatPrice1e8: event.args.fiatPrice1e8,
      fiatCurrency: event.args.fiatCurrency,
      active: true,
      listedAt: event.block.timestamp,
      soldAt: 0n,
      buyer: "",
    });
});

ponder.on("MarketplaceEscrow:Delisted", async ({ event, context }) => {
  await context.db
    .update(marketplaceListing, { id: event.args.tokenId.toString() })
    .set({ active: false });
});

ponder.on("MarketplaceEscrow:Sale", async ({ event, context }) => {
  const tokenId = event.args.tokenId.toString();
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
    fee: event.args.fee,
    netToSeller: event.args.netToSeller,
    payAsset: Number(event.args.payAsset),
    timestamp: event.block.timestamp,
  });
});
