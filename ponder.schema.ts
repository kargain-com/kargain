import { onchainTable } from "ponder";

export const passport = onchainTable("passport", (t) => ({
  id: t.text().primaryKey(),
  owner: t.text().notNull(),
  status: t.text().notNull(),
  verifier: t.text().notNull().default(""),
  verifiedAt: t.bigint().notNull().default(0n),
  tokenUri: t.text().notNull().default(""),
  createdAt: t.bigint().notNull(),
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

export const marketplaceListing = onchainTable("marketplace_listing", (t) => ({
  id: t.text().primaryKey(),
  tokenId: t.text().notNull(),
  seller: t.text().notNull(),
  fiatPrice1e8: t.bigint().notNull(),
  fiatCurrency: t.integer().notNull(),
  active: t.boolean().notNull().default(true),
  listedAt: t.bigint().notNull(),
  soldAt: t.bigint().notNull().default(0n),
  buyer: t.text().notNull().default(""),
}));

export const marketplaceSale = onchainTable("marketplace_sale", (t) => ({
  id: t.text().primaryKey(),
  tokenId: t.text().notNull(),
  buyer: t.text().notNull(),
  seller: t.text().notNull(),
  gross: t.bigint().notNull(),
  fee: t.bigint().notNull(),
  netToSeller: t.bigint().notNull(),
  payAsset: t.integer().notNull(),
  timestamp: t.bigint().notNull(),
}));

export const karProHolder = onchainTable("kar_pro_holder", (t) => ({
  id: t.text().primaryKey(),
  address: t.text().notNull(),
  tokenId: t.text().notNull(),
  active: t.boolean().notNull().default(true),
  issuedAt: t.bigint().notNull(),
}));
