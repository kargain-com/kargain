import { index, onchainTable } from "ponder";

export const passport = onchainTable("passport", (t) => ({
  id: t.text().primaryKey(),
  /** Immutable origin — `chainIdOf(tokenId)` (= `tokenId >> 128`). */
  chainId: t.integer().notNull(),
  /** Network where the usable instance currently lives (SPEC §I.12.8). */
  custodyChain: t.integer().notNull(),
  /** Timestamp of last accepted custody-changing event (monotonic gate). */
  custodyUpdatedAt: t.bigint().notNull().default(0n),
  owner: t.text().notNull(),
  status: t.text().notNull(),
  verifier: t.text().notNull().default(""),
  verifiedAt: t.bigint().notNull().default(0n),
  tokenUri: t.text().notNull().default(""),
  coverPhotoUri: t.text().notNull().default(""),
  vin: t.text().notNull().default(""),
  make: t.text().notNull().default(""),
  model: t.text().notNull().default(""),
  year: t.integer().notNull().default(0),
  mileageKm: t.integer().notNull().default(0),
  lastDisputer: t.text().notNull().default(""),
  disputeReason: t.text().notNull().default(""),
  disputeWithdrawnAt: t.bigint().notNull().default(0n),
  lastVerificationResetAt: t.bigint().notNull().default(0n),
  duplicateVin: t.boolean().notNull().default(false),
  lastMetadataChangeAt: t.bigint().notNull().default(0n),
  verificationResetCount: t.integer().notNull().default(0),
  hadDispute: t.boolean().notNull().default(false),
  lastDisputeResolvedAt: t.bigint().notNull().default(0n),
  disputeOpenedAt: t.bigint().notNull().default(0n),
  fuelType: t.text().notNull().default(""),
  bodyType: t.text().notNull().default(""),
  transmission: t.text().notNull().default(""),
  condition: t.text().notNull().default(""),
  vehicleType: t.text().notNull().default(""),
  colour: t.text().notNull().default(""),
  locationLabel: t.text().notNull().default(""),
  locationPlaceId: t.text().notNull().default(""),
  locationCountryCode: t.text().notNull().default(""),
  disputeDeposit: t.bigint(),
  createdAt: t.bigint().notNull(),
  updatedAt: t.bigint().notNull(),
}));

export const passportUriHistory = onchainTable("passport_uri_history", (t) => ({
  id: t.text().primaryKey(),
  tokenId: t.text().notNull(),
  /** Network that emitted the URI update (provenance). */
  chainId: t.integer().notNull(),
  previousUri: t.text().notNull().default(""),
  newUri: t.text().notNull(),
  author: t.text().notNull(),
  verificationReset: t.boolean().notNull().default(false),
  timestamp: t.bigint().notNull(),
}));

export const vinIndex = onchainTable("vin_index", (t) => ({
  id: t.text().primaryKey(),
  vin: t.text().notNull(),
  tokenId: t.text().notNull(),
  updatedAt: t.bigint().notNull(),
}));

export const passportRecord = onchainTable("passport_record", (t) => ({
  id: t.text().primaryKey(),
  tokenId: t.text().notNull(),
  /** Network that emitted the record (provenance; UNION by global tokenId). */
  chainId: t.integer().notNull(),
  author: t.text().notNull(),
  recordType: t.text().notNull(),
  description: t.text().notNull().default(""),
  evidenceCID: t.text().notNull().default(""),
  timestamp: t.bigint().notNull(),
}));

export const marketplaceListing = onchainTable(
  "marketplace_listing",
  (t) => ({
    id: t.text().primaryKey(),
    tokenId: t.text().notNull(),
    chainId: t.integer().notNull(),
    seller: t.text().notNull(),
    fiatPrice1e8: t.bigint().notNull(),
    currencyCode: t.text().notNull().default("USD"),
    agent: t.text().notNull().default(""),
    agentFeeBps: t.integer().notNull().default(0),
    ownerMinPrice1e8: t.bigint().notNull().default(0n),
    active: t.boolean().notNull().default(true),
    listedAt: t.bigint().notNull(),
    soldAt: t.bigint().notNull().default(0n),
    buyer: t.text().notNull().default(""),
    returnRequestedAt: t.bigint(),
    externalPaymentConfirmedAt: t.bigint(),
  }),
  (table) => ({
    agentIdx: index().on(table.agent),
  }),
);

export const marketplaceSale = onchainTable("marketplace_sale", (t) => ({
  id: t.text().primaryKey(),
  tokenId: t.text().notNull(),
  chainId: t.integer().notNull(),
  buyer: t.text().notNull(),
  seller: t.text().notNull(),
  gross: t.bigint().notNull(),
  platformFee: t.bigint().notNull(),
  agentFee: t.bigint().notNull().default(0n),
  netToSeller: t.bigint().notNull(),
  payToken: t.text().notNull().default(""),
  agent: t.text().notNull().default(""),
  timestamp: t.bigint().notNull(),
}));

export const agentAuthorization = onchainTable(
  "agent_authorization",
  (t) => ({
    id: t.text().primaryKey(),
    tokenId: t.text().notNull(),
    owner: t.text().notNull(),
    agent: t.text().notNull(),
    expiry: t.bigint().notNull().default(0n),
    ownerMinPrice1e8: t.bigint().notNull().default(0n),
    active: t.boolean().notNull().default(true),
    createdAt: t.bigint().notNull(),
    updatedAt: t.bigint().notNull(),
    authorizedAt: t.bigint().notNull(),
  }),
  (table) => ({
    agentIdx: index().on(table.agent),
    ownerIdx: index().on(table.owner),
  }),
);

export const auctionAgentAuthorization = onchainTable(
  "auction_agent_authorization",
  (t) => ({
    id: t.text().primaryKey(),
    tokenId: t.text().notNull(),
    owner: t.text().notNull(),
    agent: t.text().notNull(),
    expiry: t.bigint().notNull().default(0n),
    asset: t.text().notNull().default(""),
    ownerMinAsset: t.bigint().notNull().default(0n),
    active: t.boolean().notNull().default(true),
    createdAt: t.bigint().notNull(),
    updatedAt: t.bigint().notNull(),
    authorizedAt: t.bigint().notNull(),
  }),
  (table) => ({
    agentIdx: index().on(table.agent),
    ownerIdx: index().on(table.owner),
  }),
);

export const currencyFeed = onchainTable("currency_feed", (t) => ({
  id: t.text().primaryKey(),
  chainId: t.integer().notNull(),
  currencyCode: t.text().notNull(),
  feed: t.text().notNull(),
  registeredAt: t.bigint().notNull(),
  active: t.boolean().notNull().default(true),
}));

export const verifier = onchainTable("verifier", (t) => ({
  /** Chain-scoped PK: `${chainId}-${address.toLowerCase()}` (SPEC §I.12.12). */
  id: t.text().primaryKey(),
  chainId: t.integer().notNull(),
  address: t.text().notNull(),
  category: t.integer().notNull().default(5),
  name: t.text().notNull().default(""),
  slug: t.text().notNull().default(""),
  metadataURI: t.text().notNull().default(""),
  /** Denorm from KarPro Arweave Place selection (Geo Phase E). */
  locationLabel: t.text().notNull().default(""),
  locationPlaceId: t.text().notNull().default(""),
  locationCountryCode: t.text().notNull().default(""),
  stakeAsset: t.integer().notNull().default(0),
  stakeAmount: t.text().notNull().default("0"),
  verificationFee: t.bigint().notNull().default(0n),
  active: t.boolean().notNull().default(false),
  joinedAt: t.bigint().notNull().default(0n),
  leftAt: t.bigint().notNull().default(0n),
}));

export const auction = onchainTable(
  "auction",
  (t) => ({
    id: t.text().primaryKey(),
    tokenId: t.text().notNull(),
    chainId: t.integer().notNull(),
    seller: t.text().notNull(),
    agent: t.text().notNull().default(""),
    asset: t.text().notNull().default(""),
    reserve: t.bigint().notNull(),
    duration: t.bigint().notNull(),
    agentFeeBps: t.integer().notNull().default(0),
    ownerMinAsset: t.bigint().notNull().default(0n),
    startedAt: t.bigint().notNull().default(0n),
    endsAt: t.bigint().notNull().default(0n),
    highestBidder: t.text().notNull().default(""),
    highestBid: t.bigint().notNull().default(0n),
    active: t.boolean().notNull().default(true),
    phase: t.text().notNull().default("CREATED"),
    returnRequestedAt: t.bigint(),
    voidReason: t.text().notNull().default(""),
    createdAt: t.bigint().notNull(),
    updatedAt: t.bigint().notNull(),
  }),
  (table) => ({
    sellerIdx: index().on(table.seller),
    agentIdx: index().on(table.agent),
    activeIdx: index().on(table.active),
  }),
);

export const auctionBid = onchainTable(
  "auction_bid",
  (t) => ({
    id: t.text().primaryKey(),
    tokenId: t.text().notNull(),
    bidder: t.text().notNull(),
    amount: t.bigint().notNull(),
    endsAt: t.bigint().notNull(),
    refunded: t.boolean().notNull().default(false),
    wrappedFallback: t.boolean().notNull().default(false),
    timestamp: t.bigint().notNull(),
  }),
  (table) => ({
    tokenIdIdx: index().on(table.tokenId),
  }),
);

export const auctionSettlement = onchainTable("auction_settlement", (t) => ({
  id: t.text().primaryKey(),
  tokenId: t.text().notNull(),
  buyer: t.text().notNull(),
  gross: t.bigint().notNull(),
  releaseAt: t.bigint().notNull(),
  disputedAt: t.bigint().notNull().default(0n),
  bond: t.bigint(),
  disputeOutcome: t.text().notNull().default(""),
  receiptConfirmedAt: t.bigint(),
  platformFee: t.bigint(),
  agentFee: t.bigint(),
  net: t.bigint(),
  autoRelease: t.boolean(),
  releasedAt: t.bigint(),
  refundPendingAt: t.bigint(),
  clearedAt: t.bigint(),
  createdAt: t.bigint().notNull(),
  updatedAt: t.bigint().notNull(),
}));
