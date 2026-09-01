import { index, onchainTable, sql } from "ponder";

export const passport = onchainTable(
  "passport",
  (t) => ({
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
    /** Last closed dispute path: confirm | reject | expire | withdraw | "". */
    lastDisputeTerminal: t.text().notNull().default(""),
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
  }),
  (table) => ({
    /** Browse: status=, verifiedFirst, statusCounts groupBy */
    statusIdx: index().on(table.status),
    /** Browse: lower(make)= — matches buildBrowseFilterConditions */
    makeIdx: index().on(sql`lower(${table.make})`),
    /** Browse: lower(model)= */
    modelIdx: index().on(sql`lower(${table.model})`),
    /** Browse: yearMin/yearMax */
    yearIdx: index().on(table.year),
    /** Browse: mileageMin/mileageMax + mileage_asc ORDER BY */
    mileageIdx: index().on(table.mileageKm),
    /** Browse: placeId= → locationPlaceId */
    placeIdx: index().on(table.locationPlaceId),
    /** Browse: fuelType CSV → lower(fuelType) IN (…) */
    fuelIdx: index().on(sql`lower(${table.fuelType})`),
    /** Browse: bodyType CSV → lower(bodyType) IN (…) */
    bodyIdx: index().on(sql`lower(${table.bodyType})`),
    /** Browse: transmission CSV → lower(transmission) IN (…) */
    transmissionIdx: index().on(sql`lower(${table.transmission})`),
    /** Browse: condition CSV → lower(condition) IN (…) */
    conditionIdx: index().on(sql`lower(${table.condition})`),
    /** Browse: vehicleType CSV → lower(vehicleType) IN (…) */
    vehicleIdx: index().on(sql`lower(${table.vehicleType})`),
    // colour / search: ILIKE '%…%' — no btree; see MIGRATION-V2 (no pg_trgm yet)
  }),
);

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
  stakeAsset: t.text().notNull().default("0x0000000000000000000000000000000000000000"),
  stakeAmount: t.text().notNull().default("0"),
  verificationFee: t.bigint().notNull().default(0n),
  active: t.boolean().notNull().default(false),
  joinedAt: t.bigint().notNull().default(0n),
  leftAt: t.bigint().notNull().default(0n),
}));

/** Outstanding ClaimablePayouts balance — PK = chainId-contract-account-asset. */
export const pendingClaim = onchainTable(
  "pending_claim",
  (t) => ({
    id: t.text().primaryKey(),
    chainId: t.integer().notNull(),
    contract: t.text().notNull(),
    account: t.text().notNull(),
    asset: t.text().notNull(),
    amount: t.bigint().notNull(),
    reasonCode: t.text().notNull(),
    updatedAt: t.bigint().notNull(),
    firstCreditedAt: t.bigint().notNull(),
  }),
  (table) => ({
    accountIdx: index().on(table.account),
  }),
);

/** Append-only ClaimRecorded credits for notifications + reason history. */
export const claimCredit = onchainTable(
  "claim_credit",
  (t) => ({
    id: t.text().primaryKey(),
    chainId: t.integer().notNull(),
    contract: t.text().notNull(),
    account: t.text().notNull(),
    asset: t.text().notNull(),
    amount: t.bigint().notNull(),
    reasonCode: t.text().notNull(),
    timestamp: t.bigint().notNull(),
  }),
  (table) => ({
    accountIdx: index().on(table.account),
  }),
);

// ---------------------------------------------------------------------------
// Commerce modes (FixedPriceConsignment / AscendingConsignment) — additive.
// Live registration deferred to Nuclear #2; proven on local Hardhat.
// Do not project into marketplace_* / auction_* tables.
// ---------------------------------------------------------------------------

/** Append-only consignment open — PK = chainId-modeContract-tokenId-txHash-logIndex. */
export const consignment = onchainTable(
  "consignment",
  (t) => ({
    id: t.text().primaryKey(),
    chainId: t.integer().notNull(),
    /** fixedPrice | ascending */
    mode: t.text().notNull(),
    modeContract: t.text().notNull(),
    tokenId: t.text().notNull(),
    /** 1-based sale ordinal for (chainId, tokenId) — UI only, not a key. */
    saleOrdinal: t.integer().notNull(),
    seller: t.text().notNull(),
    agent: t.text().notNull().default(""),
    asset: t.text().notNull(),
    /** 0 = Asset, 1 = Fiat */
    denominationKind: t.integer().notNull(),
    currencyCode: t.text().notNull().default(""),
    floor: t.bigint().notNull(),
    /** 0 = Margin, 1 = Commission */
    compensationForm: t.integer().notNull(),
    commissionBps: t.integer().notNull().default(0),
    price: t.bigint().notNull(),
    platformFeeBps: t.integer().notNull(),
    /** offered | binding | held | closed | returned */
    phase: t.text().notNull(),
    closeReason: t.integer(),
    openedAt: t.bigint().notNull(),
    closedAt: t.bigint(),
    recallRequestedAt: t.bigint(),
    /** FixedPrice: buyer from Bought / ExternalPaymentConfirmed. */
    buyer: t.text().notNull().default(""),
    settlementNoteSetAt: t.bigint(),
    settlementNoteSetter: t.text().notNull().default(""),
    openTxHash: t.text().notNull(),
    openLogIndex: t.integer().notNull(),
    updatedAt: t.bigint().notNull(),
  }),
  (table) => ({
    tokenIdx: index().on(table.chainId, table.tokenId),
    sellerIdx: index().on(table.seller),
    agentIdx: index().on(table.agent),
    buyerIdx: index().on(table.buyer),
    phaseIdx: index().on(table.chainId, table.mode, table.phase),
    liveIdx: index().on(table.chainId, table.modeContract, table.tokenId, table.phase),
  }),
);

/** 1:1 Ascending terms snapshot — survives settle (storage does not). */
export const ascendingTerms = onchainTable("ascending_terms", (t) => ({
  id: t.text().primaryKey(),
  consignmentId: t.text().notNull(),
  chainId: t.integer().notNull(),
  tokenId: t.text().notNull(),
  duration: t.integer().notNull(),
  extensionWindow: t.integer().notNull(),
  protectionWindow: t.integer().notNull(),
  abandonmentWindow: t.integer().notNull(),
  minIncrementBps: t.integer().notNull(),
  reserve: t.bigint().notNull(),
}));

export const consignmentBid = onchainTable(
  "consignment_bid",
  (t) => ({
    id: t.text().primaryKey(),
    consignmentId: t.text().notNull(),
    chainId: t.integer().notNull(),
    tokenId: t.text().notNull(),
    bidder: t.text().notNull(),
    amount: t.bigint().notNull(),
    endsAt: t.bigint().notNull(),
    extended: t.boolean().notNull().default(false),
    refunded: t.boolean().notNull().default(false),
    refundAsset: t.text().notNull().default(""),
    refundAmount: t.bigint(),
    refundTxHash: t.text().notNull().default(""),
    timestamp: t.bigint().notNull(),
  }),
  (table) => ({
    consignmentIdx: index().on(table.consignmentId),
    tokenIdx: index().on(table.tokenId),
    bidderIdx: index().on(table.bidder),
    refundTxIdx: index().on(table.refundTxHash),
  }),
);

/** Ascending hold + reversal — PK = consignment id. */
export const consignmentHold = onchainTable(
  "consignment_hold",
  (t) => ({
    id: t.text().primaryKey(),
    consignmentId: t.text().notNull(),
    chainId: t.integer().notNull(),
    tokenId: t.text().notNull(),
    buyer: t.text().notNull(),
    gross: t.bigint().notNull(),
    protectionEndsAt: t.bigint().notNull(),
    /** active | receiptConfirmed | fundsReleased | reversalStarted | reversalCompleted | reversalAbandoned */
    state: t.text().notNull().default("active"),
    abandonmentDeadline: t.bigint(),
    receiptConfirmedAt: t.bigint(),
    fundsReleasedAt: t.bigint(),
    reversalStartedAt: t.bigint(),
    clearedAt: t.bigint(),
    createdAt: t.bigint().notNull(),
    updatedAt: t.bigint().notNull(),
  }),
  (table) => ({
    buyerIdx: index().on(table.buyer),
    stateIdx: index().on(table.state),
  }),
);

/**
 * BondedChallenge lifecycle — passport verification + ascending settlement.
 * PK = chainId-instanceContract-subjectId-txHash-logIndex (append-only opens).
 */
export const challenge = onchainTable(
  "challenge",
  (t) => ({
    id: t.text().primaryKey(),
    chainId: t.integer().notNull(),
    /** passport | ascending */
    instance: t.text().notNull(),
    instanceContract: t.text().notNull(),
    subjectId: t.text().notNull(),
    challenger: t.text().notNull(),
    bondAmount: t.bigint().notNull(),
    windowDuration: t.bigint().notNull(),
    openedAt: t.bigint().notNull(),
    /** open | withdrawn | judged | concluded */
    status: t.text().notNull().default("open"),
    judge: t.text().notNull().default(""),
    /** 0 upheld | 1 rejected — set on Judged */
    outcome: t.integer(),
    bondRecipient: t.text().notNull().default(""),
    terminalAt: t.bigint(),
    terminalTxHash: t.text().notNull().default(""),
    openTxHash: t.text().notNull(),
    openLogIndex: t.integer().notNull(),
    updatedAt: t.bigint().notNull(),
  }),
  (table) => ({
    subjectIdx: index().on(table.chainId, table.instanceContract, table.subjectId),
    statusIdx: index().on(table.status),
    challengerIdx: index().on(table.challenger),
    terminalTxIdx: index().on(table.terminalTxHash),
  }),
);

/** Standing mandate per mode contract + passport. */
export const mandate = onchainTable(
  "mandate",
  (t) => ({
    id: t.text().primaryKey(),
    chainId: t.integer().notNull(),
    modeContract: t.text().notNull(),
    /** fixedPrice | ascending */
    mode: t.text().notNull(),
    tokenId: t.text().notNull(),
    owner: t.text().notNull(),
    agent: t.text().notNull(),
    expiry: t.bigint().notNull().default(0n),
    asset: t.text().notNull(),
    denominationKind: t.integer().notNull(),
    currencyCode: t.text().notNull().default(""),
    floor: t.bigint().notNull(),
    compensationForm: t.integer().notNull(),
    commissionBps: t.integer().notNull().default(0),
    active: t.boolean().notNull().default(true),
    grantedAt: t.bigint().notNull(),
    revokedAt: t.bigint(),
    updatedAt: t.bigint().notNull(),
  }),
  (table) => ({
    agentIdx: index().on(table.agent),
    ownerIdx: index().on(table.owner),
    tokenIdx: index().on(table.tokenId),
  }),
);

/** Money outcome from ConsignmentSplitPaid — PK = consignment id. */
export const consignmentSettlement = onchainTable(
  "consignment_settlement",
  (t) => ({
    id: t.text().primaryKey(),
    consignmentId: t.text().notNull(),
    chainId: t.integer().notNull(),
    tokenId: t.text().notNull(),
    asset: t.text().notNull(),
    ownerRecipient: t.text().notNull(),
    ownerAmount: t.bigint().notNull(),
    agentRecipient: t.text().notNull().default(""),
    agentAmount: t.bigint().notNull().default(0n),
    platformRecipient: t.text().notNull(),
    platformAmount: t.bigint().notNull(),
    txHash: t.text().notNull(),
    timestamp: t.bigint().notNull(),
  }),
  (table) => ({
    txIdx: index().on(table.txHash),
  }),
);

/**
 * Mode ClaimablePayouts balance (new surface — not pending_claim).
 * PK = chainId-contract-account-asset.
 */
export const commerceClaim = onchainTable(
  "commerce_claim",
  (t) => ({
    id: t.text().primaryKey(),
    chainId: t.integer().notNull(),
    contract: t.text().notNull(),
    account: t.text().notNull(),
    asset: t.text().notNull(),
    amount: t.bigint().notNull(),
    updatedAt: t.bigint().notNull(),
    firstCreditedAt: t.bigint().notNull(),
  }),
  (table) => ({
    accountIdx: index().on(table.account),
  }),
);

/** Append-only commerce ClaimRecorded credits — reason via same-tx correlation. */
export const commerceClaimCredit = onchainTable(
  "commerce_claim_credit",
  (t) => ({
    id: t.text().primaryKey(),
    chainId: t.integer().notNull(),
    contract: t.text().notNull(),
    account: t.text().notNull(),
    asset: t.text().notNull(),
    amount: t.bigint().notNull(),
    reasonCode: t.text().notNull(),
    causeEvent: t.text().notNull().default(""),
    timestamp: t.bigint().notNull(),
  }),
  (table) => ({
    accountIdx: index().on(table.account),
  }),
);

/** Per-chain mode config: pause, guardian, auction rules, feed staleness. */
export const commerceMode = onchainTable("commerce_mode", (t) => ({
  id: t.text().primaryKey(),
  chainId: t.integer().notNull(),
  modeContract: t.text().notNull(),
  mode: t.text().notNull(),
  paused: t.boolean().notNull().default(false),
  guardian: t.text().notNull().default(""),
  /** Ascending AuctionRulesSet fields (0 when unset / FixedPrice). */
  minDuration: t.integer().notNull().default(0),
  maxDuration: t.integer().notNull().default(0),
  extensionWindow: t.integer().notNull().default(0),
  minIncrementBps: t.integer().notNull().default(0),
  minProtectionWindow: t.integer().notNull().default(0),
  maxProtectionWindow: t.integer().notNull().default(0),
  abandonmentWindow: t.integer().notNull().default(0),
  challengeBond: t.bigint().notNull().default(0n),
  /** FixedPrice native USD feed staleness tolerance (seconds). Per-feed; not a global bound. */
  nativeUsdStalenessTolerance: t.integer().notNull().default(0),
  updatedAt: t.bigint().notNull(),
}));

export const commercePaymentToken = onchainTable(
  "commerce_payment_token",
  (t) => ({
    id: t.text().primaryKey(),
    chainId: t.integer().notNull(),
    modeContract: t.text().notNull(),
    mode: t.text().notNull(),
    token: t.text().notNull(),
    /** FixedPrice only — empty on Ascending. */
    feed: t.text().notNull().default(""),
    decimals: t.integer().notNull().default(0),
    /** FixedPrice only — seconds; 0 when feed empty. */
    stalenessTolerance: t.integer().notNull().default(0),
    active: t.boolean().notNull().default(true),
    updatedAt: t.bigint().notNull(),
  }),
  (table) => ({
    modeIdx: index().on(table.chainId, table.modeContract),
  }),
);

/** FixedPrice fiat currency → Chainlink feed registry projection. */
export const commerceCurrencyFeed = onchainTable("commerce_currency_feed", (t) => ({
  id: t.text().primaryKey(),
  chainId: t.integer().notNull(),
  modeContract: t.text().notNull(),
  currencyCode: t.text().notNull(),
  feed: t.text().notNull(),
  /** Seconds; 0 when feed cleared. */
  stalenessTolerance: t.integer().notNull().default(0),
  updatedAt: t.bigint().notNull(),
}));

/**
 * Append-only guid-linked bridge crossings (S7b). One row per observed
 * ONFTSent / ONFTReceived side. S7c folds custody from this stream + SVM analogs.
 */
export const bridgeCrossing = onchainTable(
  "bridge_crossing",
  (t) => ({
    id: t.text().primaryKey(),
    guid: t.text().notNull(),
    direction: t.text().notNull(),
    observingChainId: t.integer().notNull(),
    peerLayerZeroEid: t.integer().notNull(),
    peerNamespace: t.integer(),
    peerNamespaceRefusal: t.text(),
    tokenId: t.text().notNull(),
    party: t.text().notNull(),
    blockNumber: t.integer().notNull(),
    logIndex: t.integer().notNull(),
    txHash: t.text().notNull(),
    timestamp: t.bigint().notNull(),
    /** Receive-side only — linked PassportBridgeMinted or CustodyLockSet unlock. */
    passportCounterpartEvent: t.text(),
    passportCounterpartLogIndex: t.integer(),
    /** absent | ambiguous when receive-side link missing or unclear. */
    passportCounterpartRefusal: t.text(),
  }),
  (table) => ({
    guidIdx: index().on(table.guid),
    tokenIdx: index().on(table.tokenId),
    chainOrderIdx: index().on(
      table.observingChainId,
      table.blockNumber,
      table.logIndex,
    ),
  }),
);
