import { ponder } from "ponder:registry";
import {
  marketplaceListing,
  marketplaceSale,
  passport,
  passportRecord,
  verifier,
} from "ponder:schema";

const ZERO_ADDRESS =
  "0x0000000000000000000000000000000000000000" as const;

ponder.on("KarPassport:PassportMinted", async ({ event, context }) => {
  await context.db.insert(passport).values({
    id: event.args.tokenId.toString(),
    owner: event.args.to,
    status: "UNVERIFIED",
    verifier: "",
    verifiedAt: 0n,
    tokenUri: event.args.uri,
    createdAt: event.block.timestamp,
    updatedAt: event.block.timestamp,
  });
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
      status: "DISPUTED",
      updatedAt: event.block.timestamp,
    });
});

ponder.on("KarPassport:DisputeResolved", async ({ event, context }) => {
  if (event.args.uphold) {
    await context.db
      .update(passport, { id: event.args.tokenId.toString() })
      .set({
        status: "VERIFIED",
        updatedAt: event.block.timestamp,
      });
  } else {
    await context.db
      .update(passport, { id: event.args.tokenId.toString() })
      .set({
        status: "UNVERIFIED",
        verifier: "",
        verifiedAt: 0n,
        updatedAt: event.block.timestamp,
      });
  }
});

ponder.on("KarPassport:PassportURIUpdated", async ({ event, context }) => {
  await context.db
    .update(passport, { id: event.args.tokenId.toString() })
    .set({
      tokenUri: event.args.newURI,
      updatedAt: event.block.timestamp,
    });
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
  await context.db
    .insert(verifier)
    .values({
      id,
      address: event.args.holder,
      category: Number(event.args.category),
      name: event.args.name,
      metadataURI: event.args.metadataURI,
      active: true,
    })
    .onConflictDoUpdate({
      address: event.args.holder,
      category: Number(event.args.category),
      name: event.args.name,
      metadataURI: event.args.metadataURI,
      active: true,
    });
});

ponder.on("KarProPass:ProfileUpdated", async ({ event, context }) => {
  await context.db
    .update(verifier, { id: event.args.holder.toLowerCase() })
    .set({
      category: Number(event.args.category),
      name: event.args.name,
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
