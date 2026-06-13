import { ponder } from "ponder:registry";
import {
  karProHolder,
  marketplaceListing,
  marketplaceSale,
  passport,
  passportRecord,
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
    id: `${tokenId}-${event.block.timestamp}-${event.args.author}`,
    tokenId,
    author: event.args.author,
    recordType: event.args.recordType,
    description: "",
    evidenceCID: "",
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

ponder.on("KarProPass:Transfer", async ({ event, context }) => {
  if (event.args.from === ZERO_ADDRESS) {
    await context.db.insert(karProHolder).values({
      id: event.args.to.toLowerCase(),
      address: event.args.to,
      tokenId: event.args.tokenId.toString(),
      active: true,
      issuedAt: event.block.timestamp,
    });
    return;
  }
  if (event.args.to === ZERO_ADDRESS) {
    await context.db
      .update(karProHolder, { id: event.args.from.toLowerCase() })
      .set({ active: false });
  }
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
