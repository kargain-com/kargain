import { index, onchainTable } from "ponder";

export const passport = onchainTable("passport", (t) => ({
  id: t.text().primaryKey(),
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
  disputeDeposit: t.bigint(),
  createdAt: t.bigint().notNull(),
  updatedAt: t.bigint().notNull(),
}));

export const passportUriHistory = onchainTable("passport_uri_history", (t) => ({
  id: t.text().primaryKey(),
  tokenId: t.text().notNull(),
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
    agent: t.text().notNull(),
    expiry: t.bigint().notNull().default(0n),
    ownerMinPrice1e8: t.bigint().notNull().default(0n),
    active: t.boolean().notNull().default(true),
  }),
  (table) => ({
    agentIdx: index().on(table.agent),
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
  id: t.text().primaryKey(),
  address: t.text().notNull(),
  category: t.integer().notNull().default(5),
  name: t.text().notNull().default(""),
  slug: t.text().notNull().default(""),
  metadataURI: t.text().notNull().default(""),
  stakeAsset: t.integer().notNull().default(0),
  stakeAmount: t.text().notNull().default("0"),
  verificationFee: t.bigint().notNull().default(0n),
  active: t.boolean().notNull().default(false),
  joinedAt: t.bigint().notNull().default(0n),
  leftAt: t.bigint().notNull().default(0n),
}));
