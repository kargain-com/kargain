/**
 * Local-validator proof: Ascending Core passport commerce (S8-E step 6).
 *
 * Asserts chain observations (never ERR/PHASE literals as sole proof):
 * - Corrective: unbound(140) · bind · rebind · registry miss(71) · retired harness(141)
 * - OpenAscendingDirect requires Verified passport; PassportNotVerified / duration / protection / reserve refuses
 * - Stub OpenDirect → AscendingOpenPath; SetPrice → TermsFixed
 * - First bid starts clock; BidFromSeller / BidTooLow; higher bid refunds prev
 * - ForceAuctionEndsAt → Settle: auction closed, hold present, buyer owns Core asset, escrow unchanged
 * - Gateway Send while hold → LeaveChainRefused(37)
 * - Challenge freeze/thaw clock; ConfirmReceipt three-leg split = fee snapshot
 * - Challenge path: uphold → reversal → completeReversal (NotPassportHolder via stranger Core asset)
 * - Pause: open/bid refuse ContractPaused
 *
 * Requires: local validator, kar_ascending + kar_passport + kar_gateway + consignment_harness +
 * kar_pro_staking + kar_pro_pass .so preloaded.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  testnetMinStakeFloorLamports,
  testnetMinStakeLamports,
} from "../../lib/web3/min-stake-sol.ts";
import {
  withStandArtifactBindings,
  type StandArtifactBindings,
} from "./stand-artifact-bindings.ts";
import { RPC_MAX_SUPPORTED_TRANSACTION_VERSION } from "../../lib/svm/rpc-max-supported-transaction-version.ts";
import {
  ASC_IX,
  CORE_ID,
  ENCUMBRANCE_SEED_PREFIX,
  RPC_DEFAULT,
  SEED,
  abandonReversalAscendingKeys,
  addEncumbranceSource,
  addTransferDelegateToCustody,
  airdrop,
  answerPdas,
  bindPassportProgramIx,
  completeReversalAscendingKeys,
  coreOwner,
  encU16,
  encU64,
  ensurePassportCommerceStack,
  expectAccountAlreadyInitialized,
  expectCustom,
  grantKeys,
  holdExitAscendingKeys,
  ix,
  judgeChallengeAscendingKeys,
  loadDeployProgramId,
  mintPassportAsset,
  openAscendingDirectKeys,
  openAscendingFromMandateKeys,
  pda,
  passportStateStatus,
  sendAndMeasure,
  settleAscendingKeys,
  setPassportStakingProgram,
  tryGatewaySend,
  verifyPassportAsset,
  type Conn,
  type IxBudgetRow,
  type Kp,
  type Meta,
  type PassportCommerceStack,
  type Pk,
} from "./stand-passport-commerce.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(__dirname, "../lab/package.json"));
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} = require("@solana/web3.js") as typeof import("@solana/web3.js");
const {
  TOKEN_PROGRAM_ID,
  createInitializeMint2Instruction,
  createInitializeAccount3Instruction,
  createMintToInstruction,
  getAccount,
  getMinimumBalanceForRentExemptMint,
  getMinimumBalanceForRentExemptAccount,
} = require("@solana/spl-token") as typeof import("@solana/spl-token");

const ROOT = path.resolve(__dirname, "../..");
const RPC = RPC_DEFAULT;
const DEPLOY = path.join(ROOT, "svm/target/deploy");

const ERR = {
  NotActiveVerifier: 2,
  SourceUnanswerable: 20,
  DisputeActive: 21,
  NotDisputeOpener: 23,
  CannotResolveOwnDispute: 26,
  NotEligibleChallenger: 28,
  CannotRouteBondToJudge: 30,
  LeaveChainRefused: 37,
  WrongPlatformRecipient: 63,
  ShortDelivery: 58,
  TransferFeeExtensionForbidden: 69,
  ModeNotEncumbranceSource: 71,
  ContractPaused: 76,
  AscendingOpenPath: 95,
  TermsFixed: 96,
  BadDuration: 102,
  ProtectionOutOfBounds: 103,
  BadReserve: 105,
  BidFromSeller: 106,
  BidFromAgent: 107,
  BidTooLow: 108,
  AuctionEnded: 110,
  AuctionNotEnded: 111,
  NoHold: 112,
  HoldNotReady: 113,
  NotHoldBuyer: 114,
  ReversalPending: 115,
  NoReversalPending: 116,
  AbandonmentNotReady: 117,
  ProtectionElapsed: 118,
  SettlementPending: 119,
  NotPassportHolder: 120,
  PassportNotVerified: 121,
  PassportProgramUnbound: 140,
  HarnessInstructionRetired: 141,
} as const;

const PHASE = { Offered: 1, Closed: 2, Returned: 3 } as const;

/** Borsh enum tags — AscendingIx order in ix.rs (BindPassportProgram = 32). */
const IX = { ...ASC_IX } as typeof ASC_IX;

const MIN_DURATION = 3 * 24 * 60 * 60;
const MIN_PROTECTION = 7 * 24 * 60 * 60;
const MIN_INCREMENT_BPS = 300;
const BPS_DENOM = 10_000n;
const RESERVE = 1000n;
const FEE_BPS = 250;
const CHALLENGE_BOND = 100_000n;
const CHALLENGE_WINDOW = 3_600n;
const STAND_UNBONDING_SECS = 2n;
const HOLD_SPACE = 114;
const CLAIM_SPACE = 81;
const TOKEN_ACCOUNT_SPACE = 165;
const ABANDONMENT_WINDOW = 30n * 24n * 60n * 60n;

function loadProgramId(name: string): Pk {
  return loadDeployProgramId(name);
}

function encodeString(s: string): Buffer {
  const body = Buffer.from(s, "utf8");
  const out = Buffer.alloc(4 + body.length);
  out.writeUInt32LE(body.length, 0);
  body.copy(out, 4);
  return out;
}

type MintedLot = {
  tokenId: Buffer;
  asset: Pk;
  state: Pk;
  passportChallenge: Pk;
  consign: Pk;
  auction: Pk;
  hold: Pk;
  escrow: Pk;
  modeChallenge: Pk;
  answers: { leave: Pk; open: Pk };
};

function lotFromMint(
  programId: Pk,
  m: { tokenId: Buffer; asset: Pk; state: Pk; challenge: Pk },
): MintedLot {
  const [consign] = pda(programId, [SEED.consignment, m.tokenId]);
  const [auction] = pda(programId, [SEED.auction, m.tokenId]);
  const [hold] = pda(programId, [SEED.hold, m.tokenId]);
  const [escrow] = pda(programId, [SEED.escrow, m.tokenId]);
  const [modeChallenge] = pda(programId, [SEED.challenge, m.tokenId]);
  const answers = answerPdas(programId, m.tokenId);
  return {
    tokenId: m.tokenId,
    asset: m.asset,
    state: m.state,
    passportChallenge: m.challenge,
    consign,
    auction,
    hold,
    escrow,
    modeChallenge,
    answers,
  };
}

async function mintCoreLot(
  conn: Conn,
  stack: PassportCommerceStack,
  programId: Pk,
  payer: Kp,
  owner: Kp,
  /** Stake PDA + signer used for VerifyPassport (may differ from owner). */
  verifier: Kp,
  verifierStake: Pk,
  verified: boolean,
): Promise<MintedLot> {
  const m = await mintPassportAsset(conn, stack, payer, owner.publicKey, "ar://asc-stand-core");
  const lot = lotFromMint(programId, m);
  if (verified) {
    await verifyPassportAsset(
      conn,
      stack,
      verifier,
      verifierStake,
      m.tokenId,
      m.asset,
      m.state,
    );
    const st = await conn.getAccountInfo(m.state);
    assert.equal(passportStateStatus(st!.data as Buffer), 1, "Verified after verify");
  }
  return lot;
}

function readConsignment(data: Buffer): {
  price: bigint;
  phase: number;
  feeBps: number;
  committed: boolean;
} {
  let o = 8 + 32 + 32 + 32 + 32;
  o += 1 + 32;
  o += 8;
  o += 1 + 2;
  const feeBps = data.readUInt16LE(o);
  o += 2;
  const price = data.readBigUInt64LE(o);
  o += 8 + 8;
  const phase = data[o]!;
  const committed = data[o + 1]! !== 0;
  return { price, phase, feeBps, committed };
}

function readAuction(data: Buffer): {
  endsAt: bigint;
  duration: bigint;
  highestBid: bigint;
  highestBidder: Pk;
} {
  let o = 8 + 32;
  const duration = data.readBigUInt64LE(o);
  o += 8;
  const endsAt = data.readBigUInt64LE(o);
  o += 8;
  o += 8 * 3;
  o += 2;
  const highestBidder = new PublicKey(data.subarray(o, o + 32));
  o += 32;
  const highestBid = data.readBigUInt64LE(o);
  return { endsAt, duration, highestBid, highestBidder };
}

function readHold(data: Buffer): {
  buyer: Pk;
  gross: bigint;
  protectionEndsAt: bigint;
  frozenRemaining: bigint;
  reversalPending: boolean;
  abandonmentDeadline: bigint;
  abandonmentWindow: bigint;
  active: boolean;
} {
  let o = 8 + 32;
  const buyer = new PublicKey(data.subarray(o, o + 32));
  o += 32;
  const gross = data.readBigUInt64LE(o);
  o += 8;
  const protectionEndsAt = data.readBigUInt64LE(o);
  o += 8;
  const frozenRemaining = data.readBigUInt64LE(o);
  o += 8;
  const reversalPending = data[o]! !== 0;
  o += 1;
  const abandonmentDeadline = data.readBigUInt64LE(o);
  o += 8;
  const abandonmentWindow = data.readBigUInt64LE(o);
  const active = !buyer.equals(PublicKey.default);
  return {
    buyer,
    gross,
    protectionEndsAt,
    frozenRemaining,
    reversalPending,
    abandonmentDeadline,
    abandonmentWindow,
    active,
  };
}

async function blockTime(conn: Conn): Promise<bigint> {
  const slot = await conn.getSlot("confirmed");
  const t = await conn.getBlockTime(slot);
  if (t == null) throw new Error("getBlockTime returned null");
  return BigInt(t);
}

function forceAuctionEndsAtIx(
  programId: Pk,
  authority: Pk,
  config: Pk,
  auction: Pk,
  tokenId: Buffer,
  endsAt: bigint | number,
) {
  return ix(
    programId,
    [
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: auction, isSigner: false, isWritable: true },
    ],
    Buffer.concat([Buffer.from([IX.ForceAuctionEndsAt]), tokenId, encU64(endsAt)]),
  );
}

function forceHoldClockIx(
  programId: Pk,
  authority: Pk,
  config: Pk,
  hold: Pk,
  tokenId: Buffer,
  protectionEndsAt: bigint | number,
  frozenRemaining: bigint | number,
  abandonmentDeadline: bigint | number,
) {
  return ix(
    programId,
    [
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: hold, isSigner: false, isWritable: true },
    ],
    Buffer.concat([
      Buffer.from([IX.ForceHoldClock]),
      tokenId,
      encU64(protectionEndsAt),
      encU64(frozenRemaining),
      encU64(abandonmentDeadline),
    ]),
  );
}

function minNextBid(highest: bigint): bigint {
  const step = (highest * BigInt(MIN_INCREMENT_BPS)) / BPS_DENOM;
  return highest + step;
}

function randomTokenId(tag: number): Buffer {
  const t = Keypair.generate().publicKey.toBuffer();
  t[0] = tag;
  return t;
}

export async function probeValidator(rpc = RPC): Promise<boolean> {
  try {
    const res = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth", params: [] }),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { result?: string };
    return body.result === "ok";
  } catch {
    return false;
  }
}

async function ensureStakingPair(
  conn: InstanceType<typeof Connection>,
  payer: InstanceType<typeof Keypair>,
  stakingProgram: InstanceType<typeof PublicKey>,
  passProgram: InstanceType<typeof PublicKey>,
) {
  const [stakingConfig] = pda(stakingProgram, [Buffer.from("config")]);
  const [passConfig] = pda(passProgram, [Buffer.from("config")]);
  const [passFreeze] = pda(passProgram, [Buffer.from("freeze")]);

  if (!(await conn.getAccountInfo(passConfig))) {
    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        ix(
          passProgram,
          [
            { pubkey: passConfig, isSigner: false, isWritable: true },
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          Buffer.concat([Buffer.from([0]), Buffer.from(stakingProgram.toBytes())]),
        ),
      ),
      [payer],
    );
  }

  if (!(await conn.getAccountInfo(stakingConfig))) {
    const minLamports = testnetMinStakeLamports();
    const floorLamports = testnetMinStakeFloorLamports();
    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        ix(
          stakingProgram,
          [
            { pubkey: stakingConfig, isSigner: false, isWritable: true },
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          Buffer.concat([
            Buffer.from([0]),
            Buffer.from(passProgram.toBytes()),
            encU64(minLamports),
            encU64(floorLamports),
            encU64(STAND_UNBONDING_SECS),
          ]),
        ),
      ),
      [payer],
    );
  }

  return { stakingConfig, passConfig, passFreeze };
}

async function joinVerifier(
  conn: InstanceType<typeof Connection>,
  stakingProgram: InstanceType<typeof PublicKey>,
  passProgram: InstanceType<typeof PublicKey>,
  stakingConfig: InstanceType<typeof PublicKey>,
  passConfig: InstanceType<typeof PublicKey>,
  passFreeze: InstanceType<typeof PublicKey>,
  verifier: InstanceType<typeof Keypair>,
) {
  const [stakePda] = pda(stakingProgram, [
    Buffer.from("stake"),
    Buffer.from(verifier.publicKey.toBytes()),
  ]);
  if (await conn.getAccountInfo(stakePda)) {
    return stakePda;
  }
  const [passAsset] = pda(passProgram, [
    Buffer.from("pass"),
    Buffer.from(verifier.publicKey.toBytes()),
  ]);
  const [passMeta] = pda(passProgram, [
    Buffer.from("pass_meta"),
    Buffer.from(verifier.publicKey.toBytes()),
  ]);
  const minLamports = testnetMinStakeLamports();
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        stakingProgram,
        [
          { pubkey: stakingConfig, isSigner: false, isWritable: false },
          { pubkey: stakePda, isSigner: false, isWritable: true },
          { pubkey: verifier.publicKey, isSigner: true, isWritable: true },
          { pubkey: passProgram, isSigner: false, isWritable: false },
          { pubkey: passConfig, isSigner: false, isWritable: true },
          { pubkey: passAsset, isSigner: false, isWritable: true },
          { pubkey: passMeta, isSigner: false, isWritable: true },
          { pubkey: passFreeze, isSigner: false, isWritable: false },
          { pubkey: CORE_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        Buffer.concat([
          Buffer.from([1]), // Join
          encU64(minLamports),
          Buffer.from([0]),
          encodeString("Asc Stand Verifier"),
          encodeString("ar://s6-asc-pass"),
        ]),
      ),
    ),
    [verifier],
  );
  return stakePda;
}

async function leaveVerifier(
  conn: InstanceType<typeof Connection>,
  stakingProgram: InstanceType<typeof PublicKey>,
  stakingConfig: InstanceType<typeof PublicKey>,
  verifier: InstanceType<typeof Keypair>,
) {
  const [stakePda] = pda(stakingProgram, [
    Buffer.from("stake"),
    Buffer.from(verifier.publicKey.toBytes()),
  ]);
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        stakingProgram,
        [
          { pubkey: stakingConfig, isSigner: false, isWritable: false },
          { pubkey: stakePda, isSigner: false, isWritable: true },
          { pubkey: verifier.publicKey, isSigner: true, isWritable: false },
        ],
        Buffer.from([2]), // Leave
      ),
    ),
    [verifier],
  );
  return stakePda;
}

async function initAscending(
  conn: InstanceType<typeof Connection>,
  programId: InstanceType<typeof PublicKey>,
  payer: InstanceType<typeof Keypair>,
  authority: InstanceType<typeof Keypair>,
  platform: InstanceType<typeof Keypair>,
  guardian: InstanceType<typeof Keypair>,
  forfeit: InstanceType<typeof Keypair>,
  stakingProgram: InstanceType<typeof PublicKey>,
) {
  const [configPda] = pda(programId, [SEED.consignConfig]);
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: configPda, isSigner: false, isWritable: true },
          { pubkey: authority.publicKey, isSigner: true, isWritable: false },
          { pubkey: platform.publicKey, isSigner: false, isWritable: false },
          { pubkey: guardian.publicKey, isSigner: false, isWritable: false },
          { pubkey: forfeit.publicKey, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        Buffer.concat([
          Buffer.from([IX.InitConfig]),
          encU16(FEE_BPS),
          encU64(CHALLENGE_BOND),
          encU64(CHALLENGE_WINDOW),
          Buffer.from(stakingProgram.toBytes()),
        ]),
      ),
    ),
    [payer, authority],
  );
  return configPda;
}

function bidIx(args: {
  programId: InstanceType<typeof PublicKey>;
  bidder: InstanceType<typeof PublicKey>;
  config: InstanceType<typeof PublicKey>;
  consignment: InstanceType<typeof PublicKey>;
  auction: InstanceType<typeof PublicKey>;
  hold: InstanceType<typeof PublicKey>;
  escrow: InstanceType<typeof PublicKey>;
  payer: InstanceType<typeof PublicKey>;
  tokenId: Buffer;
  amount: bigint;
  prevBidder?: InstanceType<typeof PublicKey>;
  /** SPL delivery accounts (after payer). */
  spl?: {
    bidderAta: InstanceType<typeof PublicKey>;
    escrowAta: InstanceType<typeof PublicKey>;
    mint: InstanceType<typeof PublicKey>;
    prevAta?: InstanceType<typeof PublicKey>;
    claim?: InstanceType<typeof PublicKey>;
    claimAta?: InstanceType<typeof PublicKey>;
  };
}) {
  const keys = [
    { pubkey: args.bidder, isSigner: true, isWritable: true },
    { pubkey: args.config, isSigner: false, isWritable: false },
    { pubkey: args.consignment, isSigner: false, isWritable: true },
    { pubkey: args.auction, isSigner: false, isWritable: true },
    { pubkey: args.hold, isSigner: false, isWritable: false },
    { pubkey: args.escrow, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: args.payer, isSigner: true, isWritable: true },
  ];
  if (args.spl) {
    keys.push(
      { pubkey: args.spl.bidderAta, isSigner: false, isWritable: true },
      { pubkey: args.spl.escrowAta, isSigner: false, isWritable: true },
      { pubkey: args.spl.mint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    );
  }
  if (args.prevBidder) {
    keys.push({ pubkey: args.prevBidder, isSigner: false, isWritable: true });
    if (args.spl) {
      keys.push({
        pubkey: args.spl.prevAta ?? args.prevBidder,
        isSigner: false,
        isWritable: true,
      });
      keys.push({ pubkey: args.spl.claim!, isSigner: false, isWritable: true });
      keys.push({ pubkey: args.spl.claimAta!, isSigner: false, isWritable: true });
    }
  }
  return ix(
    args.programId,
    keys,
    Buffer.concat([Buffer.from([IX.Bid]), args.tokenId, encU64(args.amount)]),
  );
}

function lotPdas(programId: Pk, tokenId: Buffer) {
  const [consignment] = pda(programId, [SEED.consignment, tokenId]);
  const [auction] = pda(programId, [SEED.auction, tokenId]);
  const [hold] = pda(programId, [SEED.hold, tokenId]);
  const [escrow] = pda(programId, [SEED.escrow, tokenId]);
  const [modeChallenge] = pda(programId, [SEED.challenge, tokenId]);
  const [custody] = pda(programId, [SEED.custody]);
  return { consignment, auction, hold, escrow, challenge: modeChallenge, custody };
}

/**
 * Registry-ordered may answers for the live stand suite after FixedPrice then
 * Ascending AddEncumbranceSource (registry N=2). Empty FixedPrice answer PDAs
 * are Uninitialised → may allows. Order matches add order on the shared passport config.
 */
function standRegistryMayAnswersOpen(tokenId: Buffer): Pk[] {
  const fpProgram = loadDeployProgramId("kar_fixed_price");
  const ascendingProgram = loadDeployProgramId("kar_ascending");
  return [answerPdas(fpProgram, tokenId).open, answerPdas(ascendingProgram, tokenId).open];
}

function standRegistryMayAnswersLeave(tokenId: Buffer): Pk[] {
  const fpProgram = loadDeployProgramId("kar_fixed_price");
  const ascendingProgram = loadDeployProgramId("kar_ascending");
  return [answerPdas(fpProgram, tokenId).leave, answerPdas(ascendingProgram, tokenId).leave];
}

function openAscendingIx(args: {
  programId: Pk;
  binding: Pk;
  stack: PassportCommerceStack;
  seller: Pk;
  config: Pk;
  asset: Pk;
  passportChallenge: Pk;
  passportState: Pk;
  answers: { leave: Pk; open: Pk };
  /** Registry-ordered OpenConsignment may answers (N=2 after both modes registered). */
  mayAnswers: Pk[];
  consignment: Pk;
  custody: Pk;
  payer: Pk;
  stake: Pk;
  stakingProgram: Pk;
  auction: Pk;
  tokenId: Buffer;
  reserve: bigint;
  duration: number;
  protection: number;
  assetMint?: Pk;
  paymentToken?: Pk;
}) {
  const a = args;
  const mintBuf = a.assetMint ? Buffer.from(a.assetMint.toBytes()) : Buffer.alloc(32, 0);
  const keys = openAscendingDirectKeys({
    seller: a.seller,
    config: a.config,
    paymentTok: a.paymentToken,
    binding: a.binding,
    passportConfig: a.stack.passportConfig,
    asset: a.asset,
    passportChallenge: a.passportChallenge,
    mayAnswers: a.mayAnswers,
    passportState: a.passportState,
    consign: a.consignment,
    custody: a.custody,
    payer: a.payer,
    answerLeave: a.answers.leave,
    answerOpen: a.answers.open,
    stake: a.stake,
    stakingProgram: a.stakingProgram,
    auction: a.auction,
  });
  return ix(
    a.programId,
    keys,
    Buffer.concat([
      Buffer.from([IX.OpenAscendingDirect]),
      a.tokenId,
      mintBuf,
      encU64(a.reserve),
      encU64(a.duration),
      encU64(a.protection),
    ]),
  );
}

function settleIx(args: {
  programId: Pk;
  caller: Pk;
  lot: MintedLot;
  binding: Pk;
  stack: PassportCommerceStack;
  custody: Pk;
  buyer: Pk;
  payer: Pk;
  escrowAta?: Pk;
}) {
  return ix(
    args.programId,
    settleAscendingKeys({
      caller: args.caller,
      consign: args.lot.consign,
      auction: args.lot.auction,
      hold: args.lot.hold,
      binding: args.binding,
      passportConfig: args.stack.passportConfig,
      asset: args.lot.asset,
      custody: args.custody,
      buyer: args.buyer,
      escrow: args.lot.escrow,
      payer: args.payer,
      answerLeave: args.lot.answers.leave,
      answerOpen: args.lot.answers.open,
      escrowAta: args.escrowAta,
    }),
    Buffer.concat([Buffer.from([IX.Settle]), args.lot.tokenId]),
  );
}

function confirmKeys(
  buyerPk: Pk,
  lot: MintedLot,
  binding: Pk,
  stack: PassportCommerceStack,
  configPda: Pk,
  platformPk: Pk,
  sellerPk: Pk,
  agentPk: Pk,
  payerPk: Pk,
): Meta[] {
  return holdExitAscendingKeys({
    buyerOrCaller: buyerPk,
    buyerIsSigner: true,
    config: configPda,
    consign: lot.consign,
    hold: lot.hold,
    modeChallenge: lot.modeChallenge,
    escrow: lot.escrow,
    platform: platformPk,
    seller: sellerPk,
    agent: agentPk,
    payer: payerPk,
    binding,
    passportConfig: stack.passportConfig,
    answerLeave: lot.answers.leave,
    answerOpen: lot.answers.open,
  });
}

function releaseKeys(
  lot: MintedLot,
  binding: Pk,
  stack: PassportCommerceStack,
  configPda: Pk,
  platformPk: Pk,
  sellerPk: Pk,
  agentPk: Pk,
  payerPk: Pk,
  caller: Pk,
): Meta[] {
  return holdExitAscendingKeys({
    buyerOrCaller: caller,
    buyerIsSigner: false,
    config: configPda,
    consign: lot.consign,
    hold: lot.hold,
    modeChallenge: lot.modeChallenge,
    escrow: lot.escrow,
    platform: platformPk,
    seller: sellerPk,
    agent: agentPk,
    payer: payerPk,
    binding,
    passportConfig: stack.passportConfig,
    answerLeave: lot.answers.leave,
    answerOpen: lot.answers.open,
  });
}

function judgeKeys(
  judgePk: Pk,
  lot: MintedLot,
  binding: Pk,
  stack: PassportCommerceStack,
  configPda: Pk,
  bondRecipient: Pk,
  stake: Pk,
  stakingProgram: Pk,
  platformPk: Pk,
  sellerPk: Pk,
  agentPk: Pk,
  payerPk: Pk,
): Meta[] {
  return judgeChallengeAscendingKeys({
    judge: judgePk,
    config: configPda,
    consign: lot.consign,
    hold: lot.hold,
    modeChallenge: lot.modeChallenge,
    bondRecipient,
    stake,
    stakingProgram,
    escrow: lot.escrow,
    platform: platformPk,
    seller: sellerPk,
    agent: agentPk,
    payer: payerPk,
    binding,
    passportConfig: stack.passportConfig,
    answerLeave: lot.answers.leave,
    answerOpen: lot.answers.open,
  });
}

function completeReversalKeys(
  buyerPk: Pk,
  lot: MintedLot,
  binding: Pk,
  stack: PassportCommerceStack,
  configPda: Pk,
  sellerPk: Pk,
  payerPk: Pk,
  spl?: {
    buyerAta: Pk;
    escrowAta: Pk;
    mint: Pk;
    claim: Pk;
    claimAta: Pk;
  },
  /** Plant override: Core asset whose owner ≠ hold.buyer → NotPassportHolder. */
  assetOverride?: Pk,
): Meta[] {
  const keys = completeReversalAscendingKeys({
    buyer: buyerPk,
    config: configPda,
    consign: lot.consign,
    hold: lot.hold,
    binding,
    passportConfig: stack.passportConfig,
    asset: assetOverride ?? lot.asset,
    seller: sellerPk,
    escrow: lot.escrow,
    payer: payerPk,
    answerLeave: lot.answers.leave,
    answerOpen: lot.answers.open,
  });
  if (spl) {
    keys.push(
      { pubkey: spl.buyerAta, isSigner: false, isWritable: true },
      { pubkey: spl.escrowAta, isSigner: false, isWritable: true },
      { pubkey: spl.mint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: spl.claim, isSigner: false, isWritable: true },
      { pubkey: spl.claimAta, isSigner: false, isWritable: true },
    );
  }
  return keys;
}

function abandonKeys(
  lot: MintedLot,
  binding: Pk,
  stack: PassportCommerceStack,
  configPda: Pk,
  platformPk: Pk,
  sellerPk: Pk,
  agentPk: Pk,
  payerPk: Pk,
  caller: Pk,
): Meta[] {
  return abandonReversalAscendingKeys({
    caller,
    config: configPda,
    consign: lot.consign,
    hold: lot.hold,
    escrow: lot.escrow,
    platform: platformPk,
    seller: sellerPk,
    agent: agentPk,
    payer: payerPk,
    binding,
    passportConfig: stack.passportConfig,
    answerLeave: lot.answers.leave,
    answerOpen: lot.answers.open,
  });
}

function openChallengeKeys(
  challenger: Pk,
  configPda: Pk,
  lot: MintedLot,
  payer: Pk,
): Meta[] {
  return [
    { pubkey: challenger, isSigner: true, isWritable: true },
    { pubkey: configPda, isSigner: false, isWritable: false },
    { pubkey: lot.consign, isSigner: false, isWritable: false },
    { pubkey: lot.hold, isSigner: false, isWritable: true },
    { pubkey: lot.modeChallenge, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: payer, isSigner: true, isWritable: true },
  ];
}

export async function runLiveAscending(opts?: { rpc?: string }): Promise<{
  openRefuse: {
    passportNotVerified: number;
    badDuration: number;
    protectionOutOfBounds: number;
    badReserve: number;
  };
  stubRefuse: { openDirect: number; setPrice: number };
  firstBidEndsAt: bigint;
  bidRefuse: { fromSeller: number; tooLow: number };
  refundDelta: bigint;
  settle: {
    auctionClosed: boolean;
    holdActive: boolean;
    buyerOwns: string;
    escrowDelta: bigint;
    phase: number;
    gross: bigint;
  };
  settleRent: {
    auctionBefore: bigint;
    holdAfter: bigint;
    payerDelta: bigint;
    holdRentExempt: bigint;
    settleTxFee: bigint;
    escrowDelta: bigint;
  };
  platformRecipientFamily: {
    missingUnreachable: boolean;
    wrongCode: number;
    moneyCrateMissingUnit: boolean;
  };
  challengeClock: {
    frozenBefore: bigint;
    protectionBefore: bigint;
    tOpen: bigint;
    frozenAfterOpen: bigint;
    protectionAfterOpen: bigint;
    tWithdraw: bigint;
    frozenAfterWithdraw: bigint;
    protectionAfterWithdraw: bigint;
  };
  confirmSplit: {
    phase: number;
    platformDelta: bigint;
    sellerDelta: bigint;
    agentDelta: bigint;
    gross: bigint;
    feeBps: number;
  };
  challengePath: {
    notEligible: number;
    buyerAsJudge: number;
    noReversalBeforeUphold: number;
    reversalPending: boolean;
    tUphold: bigint;
    abandonmentWindow: bigint;
    protectionAfterUphold: bigint;
    frozenAfterUphold: bigint;
    abandonmentAfterUphold: bigint;
    completePhase: number;
    buyerGrossDelta: bigint;
    assetToSeller: string;
  };
  negatives: Record<string, number>;
  splOutbidClaim: {
    claimAmount: bigint;
    claimRentExempt: bigint;
    claimAtaRentExempt: bigint;
    payerRentDelta: bigint;
    withdrawnAmount: bigint;
    claimClosed: boolean;
    claimAtaClosed: boolean;
    priorLamportsGain: bigint;
  };
  splReversal: {
    escrowSplBeforeUphold: bigint;
    bondNative: bigint;
    buyerSplAfterComplete: bigint;
    escrowSplAfterComplete: bigint;
  };
  pause: { openCode: number; bidCode: number };
  ixBudget: Record<string, IxBudgetRow>;
  ixBudgetHeaviest: string;
  artifacts: StandArtifactBindings;
}> {
  for (const name of ["kar_ascending", "kar_pro_staking", "kar_pro_pass", "kar_passport", "kar_gateway", "consignment_harness"] as const) {
    if (!existsSync(path.join(DEPLOY, `${name}.so`))) {
      throw new Error(`missing ${name}.so — build stand programs first`);
    }
  }

  const conn = new Connection(opts?.rpc ?? RPC, "confirmed");
  const programId = loadProgramId("kar_ascending");
  const stakingProgram = loadProgramId("kar_pro_staking");
  const passProgram = loadProgramId("kar_pro_pass");

  const stack = await ensurePassportCommerceStack(conn);
  await setPassportStakingProgram(conn, stack, stakingProgram);

  const payer = Keypair.generate();
  const authority = Keypair.generate();
  const guardian = Keypair.generate();
  const platform = Keypair.generate();
  const forfeit = Keypair.generate();
  const seller = Keypair.generate();
  const judge = Keypair.generate();
  const bidder1 = Keypair.generate();
  const bidder2 = Keypair.generate();
  const stranger = Keypair.generate();
  const agent = Keypair.generate();
  const inactiveVerifier = Keypair.generate();

  await airdrop(conn, payer, 80);
  for (const k of [
    authority,
    guardian,
    platform,
    forfeit,
    seller,
    judge,
    bidder1,
    bidder2,
    stranger,
    agent,
    inactiveVerifier,
  ]) {
    await airdrop(conn, k, 12);
  }

  const { stakingConfig, passConfig, passFreeze } = await ensureStakingPair(
    conn,
    payer,
    stakingProgram,
    passProgram,
  );
  const sellerStake = await joinVerifier(
    conn,
    stakingProgram,
    passProgram,
    stakingConfig,
    passConfig,
    passFreeze,
    seller,
  );
  const judgeStake = await joinVerifier(
    conn,
    stakingProgram,
    passProgram,
    stakingConfig,
    passConfig,
    passFreeze,
    judge,
  );
  const agentStake = await joinVerifier(
    conn,
    stakingProgram,
    passProgram,
    stakingConfig,
    passConfig,
    passFreeze,
    agent,
  );
  const bidder1Stake = await joinVerifier(
    conn,
    stakingProgram,
    passProgram,
    stakingConfig,
    passConfig,
    passFreeze,
    bidder1,
  );
  const forfeitStake = await joinVerifier(
    conn,
    stakingProgram,
    passProgram,
    stakingConfig,
    passConfig,
    passFreeze,
    forfeit,
  );
  const inactiveStake = await joinVerifier(
    conn,
    stakingProgram,
    passProgram,
    stakingConfig,
    passConfig,
    passFreeze,
    inactiveVerifier,
  );
  await leaveVerifier(conn, stakingProgram, stakingConfig, inactiveVerifier);

  const configPda = await initAscending(
    conn,
    programId,
    payer,
    authority,
    platform,
    guardian,
    forfeit,
    stakingProgram,
  );
  const [custodyPda] = pda(programId, [SEED.custody]);

  const [bindingPda] = pda(programId, [SEED.passportBind]);
  const ixBudget: Record<string, IxBudgetRow> = {};
  const negatives: Record<string, number> = {};

  // ---- Corrective negatives (before AddEncumbranceSource) ----
  const lotUnbound = await mintCoreLot(conn, stack, programId, payer, seller, judge, judgeStake, true);
  negatives.PassportProgramUnbound = await expectCustom(
    conn,
    new Transaction().add(
      openAscendingIx({
        programId,
        binding: bindingPda,
        stack,
        seller: seller.publicKey,
        config: configPda,
        asset: lotUnbound.asset,
        passportChallenge: lotUnbound.passportChallenge,
        passportState: lotUnbound.state,
        answers: lotUnbound.answers,
        mayAnswers: standRegistryMayAnswersOpen(lotUnbound.tokenId),
        consignment: lotUnbound.consign,
        custody: custodyPda,
        payer: payer.publicKey,
        stake: sellerStake,
        stakingProgram,
        auction: lotUnbound.auction,
        tokenId: lotUnbound.tokenId,
        reserve: RESERVE,
        duration: MIN_DURATION,
        protection: MIN_PROTECTION,
      }),
    ),
    [seller, payer],
    ERR.PassportProgramUnbound,
  );

  const [binding] = pda(programId, [SEED.passportBind]);
  ixBudget.Bind = await sendAndMeasure(
    conn,
    payer,
    bindPassportProgramIx(
      programId,
      configPda,
      authority.publicKey,
      payer.publicKey,
      stack.passportProgram,
      binding,
      ASC_IX.BindPassportProgram,
    ),
    [authority, payer],
  );

  await expectAccountAlreadyInitialized(
    conn,
    new Transaction().add(
      bindPassportProgramIx(
        programId,
        configPda,
        authority.publicKey,
        payer.publicKey,
        stack.passportProgram,
        binding,
        ASC_IX.BindPassportProgram,
      ),
    ),
    [authority, payer],
  );

  const lotRegMiss = await mintCoreLot(conn, stack, programId, payer, seller, judge, judgeStake, true);
  negatives.ModeNotEncumbranceSource = await expectCustom(
    conn,
    new Transaction().add(
      openAscendingIx({
        programId,
        binding,
        stack,
        seller: seller.publicKey,
        config: configPda,
        asset: lotRegMiss.asset,
        passportChallenge: lotRegMiss.passportChallenge,
        passportState: lotRegMiss.state,
        answers: lotRegMiss.answers,
        mayAnswers: standRegistryMayAnswersOpen(lotRegMiss.tokenId),
        consignment: lotRegMiss.consign,
        custody: custodyPda,
        payer: payer.publicKey,
        stake: sellerStake,
        stakingProgram,
        auction: lotRegMiss.auction,
        tokenId: lotRegMiss.tokenId,
        reserve: RESERVE,
        duration: MIN_DURATION,
        protection: MIN_PROTECTION,
      }),
    ),
    [seller, payer],
    ERR.ModeNotEncumbranceSource,
  );

  await addEncumbranceSource(conn, stack, programId, ENCUMBRANCE_SEED_PREFIX);

  const lotRetire = await mintCoreLot(conn, stack, programId, payer, seller, judge, judgeStake, true);
  negatives.HarnessInstructionRetired = await expectCustom(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: lotRetire.asset, isSigner: false, isWritable: true },
          { pubkey: seller.publicKey, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        Buffer.concat([Buffer.from([IX.CreateAsset]), lotRetire.tokenId]),
      ),
    ),
    [payer],
    ERR.HarnessInstructionRetired,
  );
  await expectCustom(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: authority.publicKey, isSigner: true, isWritable: false },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: lotRetire.asset, isSigner: false, isWritable: true },
        ],
        Buffer.concat([
          Buffer.from([IX.ForceAssetOwner]),
          lotRetire.tokenId,
          Buffer.from(stranger.publicKey.toBytes()),
        ]),
      ),
    ),
    [authority],
    ERR.HarnessInstructionRetired,
  );


  // ---------- Lot A: open refuses + happy path through confirm ----------
  const lotA = await mintCoreLot(conn, stack, programId, payer, seller, seller, sellerStake, false);
  const tokenA = lotA.tokenId;
  const passportNotVerified = await expectCustom(
    conn,
    new Transaction().add(
      openAscendingIx({
        programId,
        binding,
        stack,
        seller: seller.publicKey,
        config: configPda,
        asset: lotA.asset,
        passportChallenge: lotA.passportChallenge,
        passportState: lotA.state,
        answers: lotA.answers,
        mayAnswers: standRegistryMayAnswersOpen(lotA.tokenId),
        consignment: lotA.consign,
        custody: custodyPda,
        payer: payer.publicKey,
        stake: sellerStake,
        stakingProgram,
        auction: lotA.auction,
        tokenId: tokenA,
        reserve: RESERVE,
        duration: MIN_DURATION,
        protection: MIN_PROTECTION,
      }),
    ),
    [seller, payer],
    ERR.PassportNotVerified,
  );

  await verifyPassportAsset(
    conn,
    stack,
    judge,
    judgeStake,
    tokenA,
    lotA.asset,
    lotA.state,
  );
  assert.equal(passportStateStatus((await conn.getAccountInfo(lotA.state))!.data as Buffer), 1);

  const badDuration = await expectCustom(
    conn,
    new Transaction().add(
      openAscendingIx({
        programId,
        binding,
        stack,
        seller: seller.publicKey,
        config: configPda,
        asset: lotA.asset,
        passportChallenge: lotA.passportChallenge,
        passportState: lotA.state,
        answers: lotA.answers,
        mayAnswers: standRegistryMayAnswersOpen(lotA.tokenId),
        consignment: lotA.consign,
        custody: custodyPda,
        payer: payer.publicKey,
        stake: sellerStake,
        stakingProgram,
        auction: lotA.auction,
        tokenId: tokenA,
        reserve: RESERVE,
        duration: 1,
        protection: MIN_PROTECTION,
      }),
    ),
    [seller, payer],
    ERR.BadDuration,
  );

  const protectionOutOfBounds = await expectCustom(
    conn,
    new Transaction().add(
      openAscendingIx({
        programId,
        binding,
        stack,
        seller: seller.publicKey,
        config: configPda,
        asset: lotA.asset,
        passportChallenge: lotA.passportChallenge,
        passportState: lotA.state,
        answers: lotA.answers,
        mayAnswers: standRegistryMayAnswersOpen(lotA.tokenId),
        consignment: lotA.consign,
        custody: custodyPda,
        payer: payer.publicKey,
        stake: sellerStake,
        stakingProgram,
        auction: lotA.auction,
        tokenId: tokenA,
        reserve: RESERVE,
        duration: MIN_DURATION,
        protection: 1,
      }),
    ),
    [seller, payer],
    ERR.ProtectionOutOfBounds,
  );

  const badReserve = await expectCustom(
    conn,
    new Transaction().add(
      openAscendingIx({
        programId,
        binding,
        stack,
        seller: seller.publicKey,
        config: configPda,
        asset: lotA.asset,
        passportChallenge: lotA.passportChallenge,
        passportState: lotA.state,
        answers: lotA.answers,
        mayAnswers: standRegistryMayAnswersOpen(lotA.tokenId),
        consignment: lotA.consign,
        custody: custodyPda,
        payer: payer.publicKey,
        stake: sellerStake,
        stakingProgram,
        auction: lotA.auction,
        tokenId: tokenA,
        reserve: 0n,
        duration: MIN_DURATION,
        protection: MIN_PROTECTION,
      }),
    ),
    [seller, payer],
    ERR.BadReserve,
  );

  const openDirect = await expectCustom(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: seller.publicKey, isSigner: true, isWritable: false },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: lotA.asset, isSigner: false, isWritable: true },
          { pubkey: lotA.consign, isSigner: false, isWritable: true },
          { pubkey: custodyPda, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        ],
        Buffer.concat([
          Buffer.from([IX.OpenDirect]),
          tokenA,
          Buffer.alloc(32, 0),
          Buffer.from([0]),
          Buffer.alloc(32, 0),
          encU64(RESERVE),
        ]),
      ),
    ),
    [seller, payer],
    ERR.AscendingOpenPath,
  );

  const setPrice = await expectCustom(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: seller.publicKey, isSigner: true, isWritable: false },
          { pubkey: lotA.consign, isSigner: false, isWritable: true },
        ],
        Buffer.concat([Buffer.from([IX.SetPrice]), tokenA, encU64(2000)]),
      ),
    ),
    [seller],
    ERR.TermsFixed,
  );

  ixBudget.OpenAscendingDirect = await sendAndMeasure(
    conn,
    payer,
    openAscendingIx({
      programId,
      binding,
      stack,
      seller: seller.publicKey,
      config: configPda,
      asset: lotA.asset,
      passportChallenge: lotA.passportChallenge,
      passportState: lotA.state,
      answers: lotA.answers,
      mayAnswers: standRegistryMayAnswersOpen(lotA.tokenId),
      consignment: lotA.consign,
      custody: custodyPda,
      payer: payer.publicKey,
      stake: sellerStake,
      stakingProgram,
      auction: lotA.auction,
      tokenId: tokenA,
      reserve: RESERVE,
      duration: MIN_DURATION,
      protection: MIN_PROTECTION,
    }),
    [seller, payer],
  );

  const lotOpen = readConsignment((await conn.getAccountInfo(lotA.consign))!.data as Buffer);
  assert.equal(lotOpen.phase, PHASE.Offered);
  assert.equal(lotOpen.price, RESERVE);
  assert.equal(lotOpen.feeBps, FEE_BPS);

  const fromSeller = await expectCustom(
    conn,
    new Transaction().add(
      bidIx({
        programId,
        bidder: seller.publicKey,
        config: configPda,
        consignment: lotA.consign,
        auction: lotA.auction,
        hold: lotA.hold,
        escrow: lotA.escrow,
        payer: payer.publicKey,
        tokenId: tokenA,
        amount: RESERVE,
      }),
    ),
    [seller, payer],
    ERR.BidFromSeller,
  );

  const tooLow = await expectCustom(
    conn,
    new Transaction().add(
      bidIx({
        programId,
        bidder: bidder1.publicKey,
        config: configPda,
        consignment: lotA.consign,
        auction: lotA.auction,
        hold: lotA.hold,
        escrow: lotA.escrow,
        payer: payer.publicKey,
        tokenId: tokenA,
        amount: RESERVE - 1n,
      }),
    ),
    [bidder1, payer],
    ERR.BidTooLow,
  );

  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      bidIx({
        programId,
        bidder: bidder1.publicKey,
        config: configPda,
        consignment: lotA.consign,
        auction: lotA.auction,
        hold: lotA.hold,
        escrow: lotA.escrow,
        payer: payer.publicKey,
        tokenId: tokenA,
        amount: RESERVE,
      }),
    ),
    [bidder1, payer],
  );

  const auctionAfterFirst = readAuction((await conn.getAccountInfo(lotA.auction))!.data as Buffer);
  assert.ok(auctionAfterFirst.endsAt > 0n, "first bid must start clock");
  const firstBidEndsAt = auctionAfterFirst.endsAt;
  const committed = readConsignment((await conn.getAccountInfo(lotA.consign))!.data as Buffer);
  assert.equal(committed.committed, true);

  const bid2Amt = minNextBid(RESERVE);
  const balB1Before = BigInt(await conn.getBalance(bidder1.publicKey));
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      bidIx({
        programId,
        bidder: bidder2.publicKey,
        config: configPda,
        consignment: lotA.consign,
        auction: lotA.auction,
        hold: lotA.hold,
        escrow: lotA.escrow,
        payer: payer.publicKey,
        tokenId: tokenA,
        amount: bid2Amt,
        prevBidder: bidder1.publicKey,
      }),
    ),
    [bidder2, payer],
  );
  const balB1After = BigInt(await conn.getBalance(bidder1.publicKey));
  const refundDelta = balB1After - balB1Before;
  assert.equal(refundDelta, RESERVE);

  const escrowBeforeSettle = BigInt(await conn.getBalance(lotA.escrow));
  const holdAbsentBefore = (await conn.getAccountInfo(lotA.hold)) == null;
  assert.ok(holdAbsentBefore);
  const holdRentExempt = BigInt(await conn.getMinimumBalanceForRentExemption(HOLD_SPACE));

  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      forceAuctionEndsAtIx(
        programId,
        authority.publicKey,
        configPda,
        lotA.auction,
        tokenA,
        1,
      ),
    ),
    [authority],
  );

  // Snapshot immediately before Settle (after ForceAuctionEndsAt) — fee isolation needs Settle-only Δ.
  const auctionLamportsBefore = BigInt(
    (await conn.getAccountInfo(lotA.auction))?.lamports ?? 0,
  );
  const payerLamportsBeforeSettle = BigInt(await conn.getBalance(payer.publicKey));
  assert.ok(auctionLamportsBefore > 0n);

  const settleSig = await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      settleIx({
        programId,
        caller: stranger.publicKey,
        lot: lotA,
        binding,
        stack,
        custody: custodyPda,
        buyer: bidder2.publicKey,
        payer: payer.publicKey,
      }),
    ),
    [payer],
  );
  const settleParsed = await conn.getTransaction(settleSig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: RPC_MAX_SUPPORTED_TRANSACTION_VERSION,
  });
  const settleTxFee = BigInt(settleParsed?.meta?.fee ?? 0);
  {
    const settleKeys = settleAscendingKeys({
      caller: stranger.publicKey,
      consign: lotA.consign,
      auction: lotA.auction,
      hold: lotA.hold,
      binding,
      passportConfig: stack.passportConfig,
      asset: lotA.asset,
      custody: custodyPda,
      buyer: bidder2.publicKey,
      escrow: lotA.escrow,
      payer: payer.publicKey,
      answerLeave: lotA.answers.leave,
      answerOpen: lotA.answers.open,
    });
    ixBudget.Settle = {
      accounts: settleKeys.length,
      signers: settleKeys.filter((k) => k.isSigner).length,
      writable: settleKeys.filter((k) => k.isWritable).length,
      cu:
        settleParsed?.meta?.computeUnitsConsumed != null
          ? Number(settleParsed.meta.computeUnitsConsumed)
          : null,
      legacyTx: 0,
    };
  }

  const auctionInfoAfter = await conn.getAccountInfo(lotA.auction);
  const auctionClosed =
    auctionInfoAfter == null ||
    auctionInfoAfter.lamports === 0 ||
    auctionInfoAfter.data.length === 0 ||
    auctionInfoAfter.owner.equals(SystemProgram.programId);
  const holdInfoAfterSettle = await conn.getAccountInfo(lotA.hold);
  assert.ok(holdInfoAfterSettle);
  const holdLamportsAfter = BigInt(holdInfoAfterSettle!.lamports);
  assert.equal(holdLamportsAfter, holdRentExempt);
  const holdAfterSettle = readHold(holdInfoAfterSettle!.data as Buffer);
  const assetAfterSettleOwner = coreOwner((await conn.getAccountInfo(lotA.asset))!.data as Buffer);
  const escrowAfterSettle = BigInt(await conn.getBalance(lotA.escrow));
  const payerLamportsAfterSettle = BigInt(await conn.getBalance(payer.publicKey));
  const phaseAfterSettle = readConsignment(
    (await conn.getAccountInfo(lotA.consign))!.data as Buffer,
  ).phase;
  const payerDelta = payerLamportsAfterSettle - payerLamportsBeforeSettle;
  const escrowDeltaSettle = escrowAfterSettle - escrowBeforeSettle;
  assert.ok(auctionClosed);
  assert.ok(holdAfterSettle.active);
  assert.equal(assetAfterSettleOwner.toBase58(), bidder2.publicKey.toBase58());
  assert.equal(escrowDeltaSettle, 0n);
  assert.equal(holdAfterSettle.gross, bid2Amt);
  // payerDelta + holdAfter + settleTxFee === auctionBefore
  assert.equal(
    payerDelta + holdLamportsAfter + settleTxFee,
    auctionLamportsBefore,
    `settle rent: payerΔ(${payerDelta}) + hold(${holdLamportsAfter}) + fee(${settleTxFee}) !== auctionBefore(${auctionLamportsBefore})`,
  );
  const settleRent = {
    auctionBefore: auctionLamportsBefore,
    holdAfter: holdLamportsAfter,
    payerDelta,
    holdRentExempt,
    settleTxFee,
    escrowDelta: escrowDeltaSettle,
  };
  // Modes always pass Some(platform.key) — MissingPlatformRecipient (64) unreachable on-chain;
  // WrongPlatformRecipient (63) is the mode-level sibling (LIVE below). Missing is money-crate unit-only.
  const platformRecipientFamily = {
    missingUnreachable: true,
    wrongCode: ERR.WrongPlatformRecipient,
    moneyCrateMissingUnit: true,
  };


  const leaveChainSendWhileHold = await tryGatewaySend(conn, stack, bidder2, payer, {
    tokenId: lotA.tokenId,
    asset: lotA.asset,
    state: lotA.state,
    challenge: lotA.passportChallenge,
    mayAnswers: standRegistryMayAnswersLeave(lotA.tokenId),
  });
  assert.equal(leaveChainSendWhileHold, ERR.LeaveChainRefused);
  negatives.LeaveChainSendWhileHold = leaveChainSendWhileHold!;

  // Challenge freeze / thaw
  const holdBeforeChallenge = readHold((await conn.getAccountInfo(lotA.hold))!.data as Buffer);
  const tOpen = await blockTime(conn);
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: bidder2.publicKey, isSigner: true, isWritable: true },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: lotA.consign, isSigner: false, isWritable: false },
          { pubkey: lotA.hold, isSigner: false, isWritable: true },
          { pubkey: lotA.modeChallenge, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        ],
        Buffer.concat([Buffer.from([IX.OpenChallenge]), tokenA]),
      ),
    ),
    [bidder2, payer],
  );
  const holdFrozen = readHold((await conn.getAccountInfo(lotA.hold))!.data as Buffer);
  assert.equal(holdFrozen.protectionEndsAt, holdBeforeChallenge.protectionEndsAt);
  assert.equal(holdBeforeChallenge.frozenRemaining, 0n);
  assert.ok(holdFrozen.frozenRemaining > 0n);

  const tWithdraw = await blockTime(conn);
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: bidder2.publicKey, isSigner: true, isWritable: true },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: lotA.consign, isSigner: false, isWritable: false },
          { pubkey: lotA.hold, isSigner: false, isWritable: true },
          { pubkey: lotA.modeChallenge, isSigner: false, isWritable: true },
        ],
        Buffer.concat([Buffer.from([IX.WithdrawChallenge]), tokenA]),
      ),
    ),
    [bidder2],
  );
  const holdThawed = readHold((await conn.getAccountInfo(lotA.hold))!.data as Buffer);
  assert.equal(holdThawed.frozenRemaining, 0n);
  assert.ok(holdThawed.protectionEndsAt > 0n);

  const challengeClock = {
    frozenBefore: holdBeforeChallenge.frozenRemaining,
    protectionBefore: holdBeforeChallenge.protectionEndsAt,
    tOpen,
    frozenAfterOpen: holdFrozen.frozenRemaining,
    protectionAfterOpen: holdFrozen.protectionEndsAt,
    tWithdraw,
    frozenAfterWithdraw: holdThawed.frozenRemaining,
    protectionAfterWithdraw: holdThawed.protectionEndsAt,
  };

  // ConfirmReceipt — three-leg split
  const expectedPlatform = (bid2Amt * BigInt(FEE_BPS)) / BPS_DENOM;
  const expectedSeller = bid2Amt - expectedPlatform;
  const balP0 = BigInt(await conn.getBalance(platform.publicKey));
  const balS0 = BigInt(await conn.getBalance(seller.publicKey));
  const balAgent0 = BigInt(await conn.getBalance(stranger.publicKey));

  ixBudget.ConfirmReceipt = await sendAndMeasure(
    conn,
    payer,
    ix(
      programId,
      confirmKeys(
        bidder2.publicKey,
        lotA,
        binding,
        stack,
        configPda,
        platform.publicKey,
        seller.publicKey,
        stranger.publicKey,
        payer.publicKey,
      ),
      Buffer.concat([Buffer.from([IX.ConfirmReceipt]), tokenA]),
    ),
    [bidder2, payer],
  );

  const closedA = readConsignment((await conn.getAccountInfo(lotA.consign))!.data as Buffer);
  const balP1 = BigInt(await conn.getBalance(platform.publicKey));
  const balS1 = BigInt(await conn.getBalance(seller.publicKey));
  const balAgent1 = BigInt(await conn.getBalance(stranger.publicKey));
  assert.equal(closedA.phase, PHASE.Closed);
  assert.equal(balP1 - balP0, expectedPlatform);
  assert.equal(balS1 - balS0, expectedSeller);
  assert.equal(balAgent1 - balAgent0, 0n);

  // After hold-clear, LeaveChain answers are true — gateway Send ok for buyer.
  const leaveChainSendAfterConfirm = await tryGatewaySend(conn, stack, bidder2, payer, {
    tokenId: lotA.tokenId,
    asset: lotA.asset,
    state: lotA.state,
    challenge: lotA.passportChallenge,
    mayAnswers: standRegistryMayAnswersLeave(lotA.tokenId),
  });
  assert.equal(leaveChainSendAfterConfirm, null, "Send ok after ConfirmReceipt hold-clear");
  negatives.LeaveChainSendAfterConfirm = 0;

  // ---------- Lot B: challenge uphold + reversal ----------
  const lotB = await mintCoreLot(conn, stack, programId, payer, seller, judge, judgeStake, true);
  const tokenB = lotB.tokenId;
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      openAscendingIx({
        programId,
        binding,
        stack,
        seller: seller.publicKey,
        config: configPda,
        asset: lotB.asset,
        passportChallenge: lotB.passportChallenge,
        passportState: lotB.state,
        answers: lotB.answers,
        mayAnswers: standRegistryMayAnswersOpen(lotB.tokenId),
        consignment: lotB.consign,
        custody: custodyPda,
        payer: payer.publicKey,
        stake: sellerStake,
        stakingProgram,
        auction: lotB.auction,
        tokenId: tokenB,
        reserve: RESERVE,
        duration: MIN_DURATION,
        protection: MIN_PROTECTION,
      }),
    ),
    [seller, payer],
  );

  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      bidIx({
        programId,
        bidder: bidder1.publicKey,
        config: configPda,
        consignment: lotB.consign,
        auction: lotB.auction,
        hold: lotB.hold,
        escrow: lotB.escrow,
        payer: payer.publicKey,
        tokenId: tokenB,
        amount: RESERVE,
      }),
    ),
    [bidder1, payer],
  );

  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      forceAuctionEndsAtIx(
        programId,
        authority.publicKey,
        configPda,
        lotB.auction,
        tokenB,
        1,
      ),
    ),
    [authority],
  );

  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      settleIx({
        programId,
        caller: stranger.publicKey,
        lot: lotB,
        binding,
        stack,
        custody: custodyPda,
        buyer: bidder1.publicKey,
        payer: payer.publicKey,
      }),
    ),
    [payer],
  );

  const notEligible = await expectCustom(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: stranger.publicKey, isSigner: true, isWritable: true },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: lotB.consign, isSigner: false, isWritable: false },
          { pubkey: lotB.hold, isSigner: false, isWritable: true },
          { pubkey: lotB.modeChallenge, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        ],
        Buffer.concat([Buffer.from([IX.OpenChallenge]), tokenB]),
      ),
    ),
    [stranger, payer],
    ERR.NotEligibleChallenger,
  );

  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: bidder1.publicKey, isSigner: true, isWritable: true },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: lotB.consign, isSigner: false, isWritable: false },
          { pubkey: lotB.hold, isSigner: false, isWritable: true },
          { pubkey: lotB.modeChallenge, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        ],
        Buffer.concat([Buffer.from([IX.OpenChallenge]), tokenB]),
      ),
    ),
    [bidder1, payer],
  );

  const noReversalBeforeUphold = await expectCustom(
    conn,
    new Transaction().add(
      ix(
        programId,
        completeReversalKeys(
          bidder1.publicKey,
          lotB,
          binding,
          stack,
          configPda,
          seller.publicKey,
          payer.publicKey,
        ),
        Buffer.concat([Buffer.from([IX.CompleteReversal]), tokenB]),
      ),
    ),
    [bidder1, payer],
    ERR.NoReversalPending,
  );

  const buyerAsJudge = await expectCustom(
    conn,
    new Transaction().add(
      ix(
        programId,
        judgeKeys(
          bidder1.publicKey,
          lotB,
          binding,
          stack,
          configPda,
          bidder1.publicKey,
          bidder1Stake,
          stakingProgram,
          platform.publicKey,
          seller.publicKey,
          stranger.publicKey,
          payer.publicKey,
        ),
        Buffer.concat([Buffer.from([IX.JudgeChallenge]), tokenB, Buffer.from([0])]),
      ),
    ),
    [bidder1, payer],
    ERR.CannotResolveOwnDispute,
  );

  const holdBeforeUphold = readHold((await conn.getAccountInfo(lotB.hold))!.data as Buffer);
  const abandonmentWindow = holdBeforeUphold.abandonmentWindow;
  assert.equal(abandonmentWindow, ABANDONMENT_WINDOW);
  const tUphold = await blockTime(conn);
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        judgeKeys(
          judge.publicKey,
          lotB,
          binding,
          stack,
          configPda,
          bidder1.publicKey, // bond → challenger on uphold
          judgeStake,
          stakingProgram,
          platform.publicKey,
          seller.publicKey,
          stranger.publicKey,
          payer.publicKey,
        ),
        Buffer.concat([Buffer.from([IX.JudgeChallenge]), tokenB, Buffer.from([0])]), // Upheld
      ),
    ),
    [judge, payer],
  );

  const holdAfterUphold = readHold((await conn.getAccountInfo(lotB.hold))!.data as Buffer);
  assert.equal(holdAfterUphold.reversalPending, true);
  assert.equal(holdAfterUphold.protectionEndsAt, 0n);
  assert.equal(holdAfterUphold.frozenRemaining, 0n);
  assert.ok(holdAfterUphold.abandonmentDeadline > 0n);

  const balBuyerBeforeRev = BigInt(await conn.getBalance(bidder1.publicKey));
  const balEscrowBeforeRev = BigInt(await conn.getBalance(lotB.escrow));
  {
    const tx = new Transaction().add(
      ix(
        programId,
        completeReversalKeys(
          bidder1.publicKey,
          lotB,
          binding,
          stack,
          configPda,
          seller.publicKey,
          payer.publicKey,
        ),
        Buffer.concat([Buffer.from([IX.CompleteReversal]), tokenB]),
      ),
    );
    tx.feePayer = payer.publicKey;
    await sendAndConfirmTransaction(conn, tx, [payer, bidder1], { commitment: "confirmed" });
  }
  const balBuyerAfterRev = BigInt(await conn.getBalance(bidder1.publicKey));
  const balEscrowAfterRev = BigInt(await conn.getBalance(lotB.escrow));
  const assetAfterRevOwner = coreOwner((await conn.getAccountInfo(lotB.asset))!.data as Buffer);
  const phaseAfterRev = readConsignment(
    (await conn.getAccountInfo(lotB.consign))!.data as Buffer,
  ).phase;
  assert.equal(phaseAfterRev, PHASE.Returned);
  assert.equal(assetAfterRevOwner.toBase58(), seller.publicKey.toBase58());
  assert.equal(balBuyerAfterRev - balBuyerBeforeRev, RESERVE);
  assert.equal(balEscrowBeforeRev - balEscrowAfterRev, RESERVE);

  // ---------- Negatives (expectCustom each name) ----------
  async function openBidForceSettle(lot: MintedLot, buyer: Kp) {
    const tokenId = lot.tokenId;
    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        openAscendingIx({
          programId,
          binding,
          stack,
          seller: seller.publicKey,
          config: configPda,
          asset: lot.asset,
          passportChallenge: lot.passportChallenge,
          passportState: lot.state,
          answers: lot.answers,
          mayAnswers: standRegistryMayAnswersOpen(lot.tokenId),
          consignment: lot.consign,
          custody: custodyPda,
          payer: payer.publicKey,
          stake: sellerStake,
          stakingProgram,
          auction: lot.auction,
          tokenId,
          reserve: RESERVE,
          duration: MIN_DURATION,
          protection: MIN_PROTECTION,
        }),
      ),
      [seller, payer],
    );
    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        bidIx({
          programId,
          bidder: buyer.publicKey,
          config: configPda,
          consignment: lot.consign,
          auction: lot.auction,
          hold: lot.hold,
          escrow: lot.escrow,
          payer: payer.publicKey,
          tokenId,
          amount: RESERVE,
        }),
      ),
      [buyer, payer],
    );
    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        forceAuctionEndsAtIx(programId, authority.publicKey, configPda, lot.auction, tokenId, 1),
      ),
      [authority],
    );
    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        settleIx({
          programId,
          caller: stranger.publicKey,
          lot,
          binding,
          stack,
          custody: custodyPda,
          buyer: buyer.publicKey,
          payer: payer.publicKey,
        }),
      ),
      [payer],
    );
  }


  // Open refuses: inactive stake / wrong stake answer
  {
    // Inactive verifier owns asset so stake PDA wallet matches runner
    const lotN = await mintCoreLot(conn, stack, programId, payer, inactiveVerifier, seller, sellerStake, true);
    const tokenN = lotN.tokenId;
    negatives.NotActiveVerifierOpen = await expectCustom(
      conn,
      new Transaction().add(
        openAscendingIx({
        programId,
        binding,
        stack,
          seller: inactiveVerifier.publicKey,
          config: configPda,
          asset: lotN.asset,
          passportChallenge: lotN.passportChallenge,
          passportState: lotN.state,
          answers: lotN.answers,
          mayAnswers: standRegistryMayAnswersOpen(lotN.tokenId),
          consignment: lotN.consign,
          custody: custodyPda,
          payer: payer.publicKey,
          stake: inactiveStake,
          stakingProgram,
          auction: lotN.auction,
          tokenId: tokenN,
          reserve: RESERVE,
          duration: MIN_DURATION,
          protection: MIN_PROTECTION,
        }),
      ),
      [inactiveVerifier, payer],
      ERR.NotActiveVerifier,
    );
    const lotN2 = await mintCoreLot(conn, stack, programId, payer, seller, judge, judgeStake, true);
    const tokenN2 = lotN2.tokenId;
    negatives.SourceUnanswerableOpen = await expectCustom(
      conn,
      new Transaction().add(
        openAscendingIx({
        programId,
        binding,
        stack,
          seller: seller.publicKey,
          config: configPda,
          asset: lotN2.asset,
        passportChallenge: lotN2.passportChallenge,
        passportState: lotN2.state,
        answers: lotN2.answers,
        mayAnswers: standRegistryMayAnswersOpen(lotN2.tokenId),
          consignment: lotN2.consign,
          custody: custodyPda,
          payer: payer.publicKey,
          stake: SystemProgram.programId,
          stakingProgram,
          auction: lotN2.auction,
          tokenId: tokenN2,
          reserve: RESERVE,
          duration: MIN_DURATION,
          protection: MIN_PROTECTION,
        }),
      ),
      [seller, payer],
      ERR.SourceUnanswerable,
    );
  }

  // AuctionNotEnded / AuctionEnded / SettlementPending
  {
    const lotN = await mintCoreLot(conn, stack, programId, payer, seller, judge, judgeStake, true);
    const tokenN = lotN.tokenId;
    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        openAscendingIx({
        programId,
        binding,
        stack,
          seller: seller.publicKey,
          config: configPda,
          asset: lotN.asset,
        passportChallenge: lotN.passportChallenge,
        passportState: lotN.state,
        answers: lotN.answers,
        mayAnswers: standRegistryMayAnswersOpen(lotN.tokenId),
          consignment: lotN.consign,
          custody: custodyPda,
          payer: payer.publicKey,
          stake: sellerStake,
          stakingProgram,
          auction: lotN.auction,
          tokenId: tokenN,
          reserve: RESERVE,
          duration: MIN_DURATION,
          protection: MIN_PROTECTION,
        }),
      ),
      [seller, payer],
    );
    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        bidIx({
          programId,
          bidder: bidder1.publicKey,
          config: configPda,
          consignment: lotN.consign,
          auction: lotN.auction,
          hold: lotN.hold,
          escrow: lotN.escrow,
          payer: payer.publicKey,
          tokenId: tokenN,
          amount: RESERVE,
        }),
      ),
      [bidder1, payer],
    );
    negatives.AuctionNotEnded = await expectCustom(
      conn,
      new Transaction().add(
        settleIx({
          programId,
          caller: stranger.publicKey,
          lot: lotN,
          binding,
          stack,
          custody: custodyPda,
          buyer: bidder1.publicKey,
          payer: payer.publicKey,
        }),
      ),
      [payer],
      ERR.AuctionNotEnded,
    );
    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        forceAuctionEndsAtIx(programId, authority.publicKey, configPda, lotN.auction, tokenN, 1),
      ),
      [authority],
    );
    negatives.AuctionEnded = await expectCustom(
      conn,
      new Transaction().add(
        bidIx({
          programId,
          bidder: bidder2.publicKey,
          config: configPda,
          consignment: lotN.consign,
          auction: lotN.auction,
          hold: lotN.hold,
          escrow: lotN.escrow,
          payer: payer.publicKey,
          tokenId: tokenN,
          amount: minNextBid(RESERVE),
          prevBidder: bidder1.publicKey,
        }),
      ),
      [bidder2, payer],
      ERR.AuctionEnded,
    );
    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        settleIx({
          programId,
          caller: stranger.publicKey,
          lot: lotN,
          binding,
          stack,
          custody: custodyPda,
          buyer: bidder1.publicKey,
          payer: payer.publicKey,
        }),
      ),
      [payer],
    );
    negatives.SettlementPendingBid = await expectCustom(
      conn,
      new Transaction().add(
        bidIx({
          programId,
          bidder: bidder2.publicKey,
          config: configPda,
          consignment: lotN.consign,
          auction: lotN.auction,
          hold: lotN.hold,
          escrow: lotN.escrow,
          payer: payer.publicKey,
          tokenId: tokenN,
          amount: RESERVE,
        }),
      ),
      [bidder2, payer],
      ERR.SettlementPending,
    );
    negatives.SettlementPendingSettle = await expectCustom(
      conn,
      new Transaction().add(
        settleIx({
          programId,
          caller: stranger.publicKey,
          lot: lotN,
          binding,
          stack,
          custody: custodyPda,
          buyer: bidder1.publicKey,
          payer: payer.publicKey,
        }),
      ),
      [payer],
      ERR.SettlementPending,
    );
    negatives.HoldNotReady = await expectCustom(
      conn,
      new Transaction().add(
        ix(programId, releaseKeys(lotN, binding, stack, configPda, platform.publicKey, seller.publicKey, stranger.publicKey, payer.publicKey, stranger.publicKey), Buffer.concat([Buffer.from([IX.ReleaseFunds]), tokenN])),
      ),
      [payer],
      ERR.HoldNotReady,
    );
  }

  // Hold-path negatives on a dedicated lot
  {
    const lotN = await mintCoreLot(conn, stack, programId, payer, seller, judge, judgeStake, true);
    const tokenN = lotN.tokenId;
    await openBidForceSettle(lotN, bidder1);

    negatives.NotHoldBuyerConfirm = await expectCustom(
      conn,
      new Transaction().add(
        ix(
          programId,
          confirmKeys(stranger.publicKey, lotN, binding, stack, configPda, platform.publicKey, seller.publicKey, stranger.publicKey, payer.publicKey),
          Buffer.concat([Buffer.from([IX.ConfirmReceipt]), tokenN]),
        ),
      ),
      [stranger, payer],
      ERR.NotHoldBuyer,
    );

    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        ix(
          programId,
          [
            { pubkey: bidder1.publicKey, isSigner: true, isWritable: true },
            { pubkey: configPda, isSigner: false, isWritable: false },
            { pubkey: lotN.consign, isSigner: false, isWritable: false },
            { pubkey: lotN.hold, isSigner: false, isWritable: true },
            { pubkey: lotN.modeChallenge, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          ],
          Buffer.concat([Buffer.from([IX.OpenChallenge]), tokenN]),
        ),
      ),
      [bidder1, payer],
    );

    negatives.DisputeActiveConfirm = await expectCustom(
      conn,
      new Transaction().add(
        ix(
          programId,
          confirmKeys(bidder1.publicKey, lotN, binding, stack, configPda, platform.publicKey, seller.publicKey, stranger.publicKey, payer.publicKey),
          Buffer.concat([Buffer.from([IX.ConfirmReceipt]), tokenN]),
        ),
      ),
      [bidder1, payer],
      ERR.DisputeActive,
    );
    negatives.DisputeActiveRelease = await expectCustom(
      conn,
      new Transaction().add(
        ix(programId, releaseKeys(lotN, binding, stack, configPda, platform.publicKey, seller.publicKey, stranger.publicKey, payer.publicKey, stranger.publicKey), Buffer.concat([Buffer.from([IX.ReleaseFunds]), tokenN])),
      ),
      [payer],
      ERR.DisputeActive,
    );
    negatives.NotDisputeOpener = await expectCustom(
      conn,
      new Transaction().add(
        ix(
          programId,
          [
            { pubkey: stranger.publicKey, isSigner: true, isWritable: true },
            { pubkey: configPda, isSigner: false, isWritable: false },
            { pubkey: lotN.consign, isSigner: false, isWritable: false },
            { pubkey: lotN.hold, isSigner: false, isWritable: true },
            { pubkey: lotN.modeChallenge, isSigner: false, isWritable: true },
          ],
          Buffer.concat([Buffer.from([IX.WithdrawChallenge]), tokenN]),
        ),
      ),
      [stranger],
      ERR.NotDisputeOpener,
    );
    negatives.NotActiveVerifierJudge = await expectCustom(
      conn,
      new Transaction().add(
        ix(
          programId,
          judgeKeys(
            inactiveVerifier.publicKey,
            lotN,
            binding,
            stack,
            configPda,
            bidder1.publicKey,
            inactiveStake,
            stakingProgram,
            platform.publicKey,
            seller.publicKey,
            stranger.publicKey,
            payer.publicKey,
          ),
          Buffer.concat([Buffer.from([IX.JudgeChallenge]), tokenN, Buffer.from([0])]),
        ),
      ),
      [inactiveVerifier, payer],
      ERR.NotActiveVerifier,
    );
    negatives.SourceUnanswerableJudge = await expectCustom(
      conn,
      new Transaction().add(
        ix(
          programId,
          judgeKeys(
            judge.publicKey,
            lotN,
            binding,
            stack,
            configPda,
            bidder1.publicKey,
            SystemProgram.programId, // intentional non-stake
            stakingProgram,
            platform.publicKey,
            seller.publicKey,
            stranger.publicKey,
            payer.publicKey,
          ),
          Buffer.concat([Buffer.from([IX.JudgeChallenge]), tokenN, Buffer.from([0])]),
        ),
      ),
      [judge, payer],
      ERR.SourceUnanswerable,
    );
    negatives.SellerCannotResolveOwnDispute = await expectCustom(
      conn,
      new Transaction().add(
        ix(
          programId,
          judgeKeys(
            seller.publicKey,
            lotN,
            binding,
            stack,
            configPda,
            bidder1.publicKey,
            sellerStake,
            stakingProgram,
            platform.publicKey,
            seller.publicKey,
            stranger.publicKey,
            payer.publicKey,
          ),
          Buffer.concat([Buffer.from([IX.JudgeChallenge]), tokenN, Buffer.from([0])]),
        ),
      ),
      [seller, payer],
      ERR.CannotResolveOwnDispute,
    );
    // Reject with forfeit as judge → CannotRouteBondToJudge
    negatives.CannotRouteBondToJudge = await expectCustom(
      conn,
      new Transaction().add(
        ix(
          programId,
          judgeKeys(
            forfeit.publicKey,
            lotN,
            binding,
            stack,
            configPda,
            forfeit.publicKey,
            forfeitStake,
            stakingProgram,
            platform.publicKey,
            seller.publicKey,
            stranger.publicKey,
            payer.publicKey,
          ),
          Buffer.concat([Buffer.from([IX.JudgeChallenge]), tokenN, Buffer.from([1])]), // Rejected
        ),
      ),
      [forfeit, payer],
      ERR.CannotRouteBondToJudge,
    );

    // Uphold then ReversalPending / AbandonmentNotReady / NotHoldBuyer Abandon+Complete / NotPassportHolder
    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        ix(
          programId,
          judgeKeys(
            judge.publicKey,
            lotN,
            binding,
            stack,
            configPda,
            bidder1.publicKey,
            judgeStake,
            stakingProgram,
            platform.publicKey,
            seller.publicKey,
            stranger.publicKey,
            payer.publicKey,
          ),
          Buffer.concat([Buffer.from([IX.JudgeChallenge]), tokenN, Buffer.from([0])]),
        ),
      ),
      [judge, payer],
    );

    negatives.ReversalPendingConfirm = await expectCustom(
      conn,
      new Transaction().add(
        ix(
          programId,
          confirmKeys(bidder1.publicKey, lotN, binding, stack, configPda, platform.publicKey, seller.publicKey, stranger.publicKey, payer.publicKey),
          Buffer.concat([Buffer.from([IX.ConfirmReceipt]), tokenN]),
        ),
      ),
      [bidder1, payer],
      ERR.ReversalPending,
    );
    negatives.ReversalPendingRelease = await expectCustom(
      conn,
      new Transaction().add(
        ix(programId, releaseKeys(lotN, binding, stack, configPda, platform.publicKey, seller.publicKey, stranger.publicKey, payer.publicKey, stranger.publicKey), Buffer.concat([Buffer.from([IX.ReleaseFunds]), tokenN])),
      ),
      [payer],
      ERR.ReversalPending,
    );
    negatives.ReversalPendingOpenChallenge = await expectCustom(
      conn,
      new Transaction().add(
        ix(
          programId,
          [
            { pubkey: bidder1.publicKey, isSigner: true, isWritable: true },
            { pubkey: configPda, isSigner: false, isWritable: false },
            { pubkey: lotN.consign, isSigner: false, isWritable: false },
            { pubkey: lotN.hold, isSigner: false, isWritable: true },
            { pubkey: lotN.modeChallenge, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          ],
          Buffer.concat([Buffer.from([IX.OpenChallenge]), tokenN]),
        ),
      ),
      [bidder1, payer],
      ERR.ReversalPending,
    );
    negatives.AbandonmentNotReady = await expectCustom(
      conn,
      new Transaction().add(
        ix(
          programId,
          abandonKeys(
            lotN,
            binding,
            stack,
            configPda,
            platform.publicKey,
            seller.publicKey,
            stranger.publicKey,
            payer.publicKey,
            stranger.publicKey,
          ),
          Buffer.concat([Buffer.from([IX.AbandonReversal]), tokenN]),
        ),
      ),
      [payer],
      ERR.AbandonmentNotReady,
    );
    negatives.NotHoldBuyerComplete = await expectCustom(
      conn,
      new Transaction().add(
        ix(
          programId,
          completeReversalKeys(
            stranger.publicKey,
            lotN,
            binding,
            stack,
            configPda,
            seller.publicKey,
            payer.publicKey,
          ),
          Buffer.concat([Buffer.from([IX.CompleteReversal]), tokenN]),
        ),
      ),
      [stranger, payer],
      ERR.NotHoldBuyer,
    );
    // Stranger-owned Core asset (not lotN) → owner ≠ hold.buyer → NotPassportHolder
    const lotAway = await mintCoreLot(
      conn,
      stack,
      programId,
      payer,
      stranger,
      judge,
      judgeStake,
      true,
    );
    negatives.NotPassportHolder = await expectCustom(
      conn,
      new Transaction().add(
        ix(
          programId,
          completeReversalKeys(
            bidder1.publicKey,
            lotN,
            binding,
            stack,
            configPda,
            seller.publicKey,
            payer.publicKey,
            undefined,
            lotAway.asset,
          ),
          Buffer.concat([Buffer.from([IX.CompleteReversal]), tokenN]),
        ),
      ),
      [bidder1, payer],
      ERR.NotPassportHolder,
    );
  }

  // ProtectionElapsed / WrongPlatformRecipient / NoHold / BidFromAgent
  {
    const lotN = await mintCoreLot(conn, stack, programId, payer, seller, judge, judgeStake, true);
    const tokenN = lotN.tokenId;
    await openBidForceSettle(lotN, bidder2);
    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        forceHoldClockIx(programId, authority.publicKey, configPda, lotN.hold, tokenN, 1, 0, 0),
      ),
      [authority],
    );
    negatives.ProtectionElapsed = await expectCustom(
      conn,
      new Transaction().add(
        ix(
          programId,
          [
            { pubkey: bidder2.publicKey, isSigner: true, isWritable: true },
            { pubkey: configPda, isSigner: false, isWritable: false },
            { pubkey: lotN.consign, isSigner: false, isWritable: false },
            { pubkey: lotN.hold, isSigner: false, isWritable: true },
            { pubkey: lotN.modeChallenge, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          ],
          Buffer.concat([Buffer.from([IX.OpenChallenge]), tokenN]),
        ),
      ),
      [bidder2, payer],
      ERR.ProtectionElapsed,
    );
    // Restore protection so confirm can succeed for WrongPlatform / NoHold
    const now = await blockTime(conn);
    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        forceHoldClockIx(
          programId,
          authority.publicKey,
          configPda,
          lotN.hold,
          tokenN,
          now + BigInt(MIN_PROTECTION),
          0,
          0,
        ),
      ),
      [authority],
    );
    negatives.WrongPlatformRecipient = await expectCustom(
      conn,
      new Transaction().add(
        ix(
          programId,
          confirmKeys(bidder2.publicKey, lotN, binding, stack, configPda, stranger.publicKey, seller.publicKey, stranger.publicKey, payer.publicKey),
          Buffer.concat([Buffer.from([IX.ConfirmReceipt]), tokenN]),
        ),
      ),
      [bidder2, payer],
      ERR.WrongPlatformRecipient,
    );
    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        ix(
          programId,
          confirmKeys(bidder2.publicKey, lotN, binding, stack, configPda, platform.publicKey, seller.publicKey, stranger.publicKey, payer.publicKey),
          Buffer.concat([Buffer.from([IX.ConfirmReceipt]), tokenN]),
        ),
      ),
      [bidder2, payer],
    );
    negatives.NoHold = await expectCustom(
      conn,
      new Transaction().add(
        ix(
          programId,
          confirmKeys(bidder2.publicKey, lotN, binding, stack, configPda, platform.publicKey, seller.publicKey, stranger.publicKey, payer.publicKey),
          Buffer.concat([Buffer.from([IX.ConfirmReceipt]), tokenN]),
        ),
      ),
      [bidder2, payer],
      ERR.NoHold,
    );
  }

  // BidFromAgent via Grant + OpenAscendingFromMandate
  {
    const lotN = await mintCoreLot(conn, stack, programId, payer, seller, judge, judgeStake, true);
    const tokenN = lotN.tokenId;
    const [mandateN] = pda(programId, [SEED.mandate, tokenN]);
    await addTransferDelegateToCustody(conn, seller, payer, lotN.asset, custodyPda);
    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        ix(
          programId,
          grantKeys({
            owner: seller.publicKey,
            binding,
            asset: lotN.asset,
            mandate: mandateN,
            consign: lotN.consign,
            custody: custodyPda,
            payer: payer.publicKey,
          }),
          Buffer.concat([
            Buffer.from([IX.Grant]),
            tokenN,
            Buffer.from(agent.publicKey.toBytes()),
            encU64(0),
            Buffer.alloc(32, 0),
            Buffer.from([0]), // Asset denom
            Buffer.alloc(32, 0),
            encU64(700),
            Buffer.from([0]), // Margin
            encU16(0),
          ]),
        ),
      ),
      [seller, payer],
    );
    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        ix(
          programId,
          openAscendingFromMandateKeys({
            agent: agent.publicKey,
            config: configPda,
            mandate: mandateN,
            binding,
            passportConfig: stack.passportConfig,
            asset: lotN.asset,
            passportChallenge: lotN.passportChallenge,
            mayAnswers: standRegistryMayAnswersOpen(lotN.tokenId),
            passportState: lotN.state,
            consign: lotN.consign,
            custody: custodyPda,
            payer: payer.publicKey,
            answerLeave: lotN.answers.leave,
            answerOpen: lotN.answers.open,
            stake: agentStake,
            stakingProgram,
            auction: lotN.auction,
          }),
          Buffer.concat([
            Buffer.from([IX.OpenAscendingFromMandate]),
            tokenN,
            encU64(RESERVE),
            encU64(MIN_DURATION),
            encU64(MIN_PROTECTION),
          ]),
        ),
      ),
      [agent, payer],
    );
    negatives.BidFromAgent = await expectCustom(
      conn,
      new Transaction().add(
        bidIx({
          programId,
          bidder: agent.publicKey,
          config: configPda,
          consignment: lotN.consign,
          auction: lotN.auction,
          hold: lotN.hold,
          escrow: lotN.escrow,
          payer: payer.publicKey,
          tokenId: tokenN,
          amount: RESERVE,
        }),
      ),
      [agent, payer],
      ERR.BidFromAgent,
    );
  }

  // Map SettlementPending* → SettlementPending for outer assert convenience
  negatives.SettlementPending = negatives.SettlementPendingBid!;
  negatives.NotHoldBuyer = negatives.NotHoldBuyerConfirm!;
  negatives.DisputeActive = negatives.DisputeActiveConfirm!;
  negatives.ReversalPending = negatives.ReversalPendingConfirm!;
  negatives.NotActiveVerifier = negatives.NotActiveVerifierJudge!;
  negatives.SourceUnanswerable = negatives.SourceUnanswerableJudge!;

  // ---------- SPL vessel + unreachable outbid claim ----------
  const mint = Keypair.generate();
  const mintLamports = await getMinimumBalanceForRentExemptMint(conn);
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mint.publicKey,
        space: 82,
        lamports: mintLamports,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(mint.publicKey, 6, payer.publicKey, null),
    ),
    [payer, mint],
  );
  const [payTok] = pda(programId, [SEED.paymentToken, mint.publicKey.toBuffer()]);
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: authority.publicKey, isSigner: true, isWritable: false },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: mint.publicKey, isSigner: false, isWritable: false },
          { pubkey: payTok, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        ],
        Buffer.from([IX.ApprovePaymentToken]),
      ),
    ),
    [authority, payer],
  );

  const lotS = await mintCoreLot(conn, stack, programId, payer, seller, judge, judgeStake, true);
  const tokenS = lotS.tokenId;
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      openAscendingIx({
        programId,
        binding,
        stack,
        seller: seller.publicKey,
        config: configPda,
        asset: lotS.asset,
        passportChallenge: lotS.passportChallenge,
        passportState: lotS.state,
        answers: lotS.answers,
        mayAnswers: standRegistryMayAnswersOpen(lotS.tokenId),
        consignment: lotS.consign,
        custody: custodyPda,
        payer: payer.publicKey,
        stake: sellerStake,
        stakingProgram,
        auction: lotS.auction,
        tokenId: tokenS,
        reserve: RESERVE,
        duration: MIN_DURATION,
        protection: MIN_PROTECTION,
        assetMint: mint.publicKey,
        paymentToken: payTok,
      }),
    ),
    [seller, payer],
  );

  const ataRent = await getMinimumBalanceForRentExemptAccount(conn);
  const claimRentExempt = BigInt(await conn.getMinimumBalanceForRentExemption(CLAIM_SPACE));
  const claimAtaRentExempt = BigInt(
    await conn.getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_SPACE),
  );
  const bidder1Ata = Keypair.generate();
  const bidder2Ata = Keypair.generate();
  const escrowAta = Keypair.generate();
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: bidder1Ata.publicKey,
        space: TOKEN_ACCOUNT_SPACE,
        lamports: ataRent,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeAccount3Instruction(bidder1Ata.publicKey, mint.publicKey, bidder1.publicKey),
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: bidder2Ata.publicKey,
        space: TOKEN_ACCOUNT_SPACE,
        lamports: ataRent,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeAccount3Instruction(bidder2Ata.publicKey, mint.publicKey, bidder2.publicKey),
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: escrowAta.publicKey,
        space: TOKEN_ACCOUNT_SPACE,
        lamports: ataRent,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeAccount3Instruction(escrowAta.publicKey, mint.publicKey, lotS.escrow),
      createMintToInstruction(mint.publicKey, bidder1Ata.publicKey, payer.publicKey, Number(RESERVE)),
      createMintToInstruction(
        mint.publicKey,
        bidder2Ata.publicKey,
        payer.publicKey,
        Number(minNextBid(RESERVE)),
      ),
    ),
    [payer, bidder1Ata, bidder2Ata, escrowAta],
  );

  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      bidIx({
        programId,
        bidder: bidder1.publicKey,
        config: configPda,
        consignment: lotS.consign,
        auction: lotS.auction,
        hold: lotS.hold,
        escrow: lotS.escrow,
        payer: payer.publicKey,
        tokenId: tokenS,
        amount: RESERVE,
        spl: {
          bidderAta: bidder1Ata.publicKey,
          escrowAta: escrowAta.publicKey,
          mint: mint.publicKey,
        },
      }),
    ),
    [bidder1, payer],
  );

  const [priorClaim] = pda(programId, [
    Buffer.from("claim"),
    bidder1.publicKey.toBuffer(),
    mint.publicKey.toBuffer(),
  ]);
  const [priorClaimAta] = pda(programId, [
    Buffer.from("claim-ata"),
    bidder1.publicKey.toBuffer(),
    mint.publicKey.toBuffer(),
  ]);
  // Absent prior ATA → claim (pass bidder1 pubkey as unreachable prevAta placeholder)
  const absentPrevAta = Keypair.generate().publicKey;
  const payerBeforeClaim = BigInt(await conn.getBalance(payer.publicKey));
  const bid2Spl = minNextBid(RESERVE);
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      bidIx({
        programId,
        bidder: bidder2.publicKey,
        config: configPda,
        consignment: lotS.consign,
        auction: lotS.auction,
        hold: lotS.hold,
        escrow: lotS.escrow,
        payer: payer.publicKey,
        tokenId: tokenS,
        amount: bid2Spl,
        prevBidder: bidder1.publicKey,
        spl: {
          bidderAta: bidder2Ata.publicKey,
          escrowAta: escrowAta.publicKey,
          mint: mint.publicKey,
          prevAta: absentPrevAta,
          claim: priorClaim,
          claimAta: priorClaimAta,
        },
      }),
    ),
    [bidder2, payer],
  );
  const payerAfterClaim = BigInt(await conn.getBalance(payer.publicKey));
  const payerRentDelta = payerBeforeClaim - payerAfterClaim;
  const claimInfo = await conn.getAccountInfo(priorClaim);
  assert.ok(claimInfo, "outbid with absent ATA must credit claim");
  const claimAmount = claimInfo!.data.readBigUInt64LE(8 + 32 + 32);
  assert.equal(claimAmount, RESERVE);
  const claimTok = await getAccount(conn, priorClaimAta);
  assert.equal(claimTok.amount, RESERVE);

  // WithdrawClaim: create destination ATA, withdraw closes claim + claim ATA
  const withdrawDest = Keypair.generate();
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: withdrawDest.publicKey,
        space: TOKEN_ACCOUNT_SPACE,
        lamports: ataRent,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeAccount3Instruction(withdrawDest.publicKey, mint.publicKey, bidder1.publicKey),
    ),
    [payer, withdrawDest],
  );
  const priorLamportsBeforeWithdraw = BigInt(await conn.getBalance(bidder1.publicKey));
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: bidder1.publicKey, isSigner: true, isWritable: true },
          { pubkey: priorClaim, isSigner: false, isWritable: true },
          { pubkey: priorClaimAta, isSigner: false, isWritable: true },
          { pubkey: withdrawDest.publicKey, isSigner: false, isWritable: true },
          { pubkey: mint.publicKey, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        Buffer.from([IX.WithdrawClaim]),
      ),
    ),
    [bidder1],
  );
  const withdrawnAmount = (await getAccount(conn, withdrawDest.publicKey)).amount;
  const claimClosed = (await conn.getAccountInfo(priorClaim)) == null;
  const claimAtaClosed = (await conn.getAccountInfo(priorClaimAta)) == null;
  const priorLamportsGain =
    BigInt(await conn.getBalance(bidder1.publicKey)) - priorLamportsBeforeWithdraw;
  assert.equal(withdrawnAmount, RESERVE);
  assert.ok(claimClosed);
  assert.ok(claimAtaClosed);

  const splOutbidClaim = {
    claimAmount,
    claimRentExempt,
    claimAtaRentExempt,
    payerRentDelta,
    withdrawnAmount,
    claimClosed,
    claimAtaClosed,
    priorLamportsGain,
  };

  // SPL lot: settle → native bond OpenChallenge → uphold → CompleteReversal SPL
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      forceAuctionEndsAtIx(programId, authority.publicKey, configPda, lotS.auction, tokenS, 1),
    ),
    [authority],
  );
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
            settleIx({
        programId,
        caller: stranger.publicKey,
        lot: lotS,
        binding,
        stack,
        custody: custodyPda,
        buyer: bidder2.publicKey,
        payer: payer.publicKey,
        escrowAta: escrowAta.publicKey,
      }),
    ),
    [payer],
  );
  const escrowSplBeforeUphold = (await getAccount(conn, escrowAta.publicKey)).amount;
  assert.equal(escrowSplBeforeUphold, bid2Spl);

  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: bidder2.publicKey, isSigner: true, isWritable: true },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: lotS.consign, isSigner: false, isWritable: false },
          { pubkey: lotS.hold, isSigner: false, isWritable: true },
          { pubkey: lotS.modeChallenge, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        ],
        Buffer.concat([Buffer.from([IX.OpenChallenge]), tokenS]),
      ),
    ),
    [bidder2, payer],
  );
  const bondNative = CHALLENGE_BOND;
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        judgeKeys(
          judge.publicKey,
          lotS,
          binding,
          stack,
          configPda,
          bidder2.publicKey,
          judgeStake,
          stakingProgram,
          platform.publicKey,
          seller.publicKey,
          stranger.publicKey,
          payer.publicKey,
        ),
        Buffer.concat([Buffer.from([IX.JudgeChallenge]), tokenS, Buffer.from([0])]),
      ),
    ),
    [judge, payer],
  );

  const [buyer2Claim] = pda(programId, [
    Buffer.from("claim"),
    bidder2.publicKey.toBuffer(),
    mint.publicKey.toBuffer(),
  ]);
  const [buyer2ClaimAta] = pda(programId, [
    Buffer.from("claim-ata"),
    bidder2.publicKey.toBuffer(),
    mint.publicKey.toBuffer(),
  ]);
  const buyerSplBefore = BigInt((await getAccount(conn, bidder2Ata.publicKey)).amount);
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        completeReversalKeys(
          bidder2.publicKey,
          lotS,
          binding,
          stack,
          configPda,
          seller.publicKey,
          payer.publicKey,
          {
            buyerAta: bidder2Ata.publicKey,
            escrowAta: escrowAta.publicKey,
            mint: mint.publicKey,
            claim: buyer2Claim,
            claimAta: buyer2ClaimAta,
          },
        ),
        Buffer.concat([Buffer.from([IX.CompleteReversal]), tokenS]),
      ),
    ),
    [bidder2, payer],
  );
  const buyerSplDelta =
    BigInt((await getAccount(conn, bidder2Ata.publicKey)).amount) - buyerSplBefore;
  const escrowSplAfterComplete = BigInt(
    (await getAccount(conn, escrowAta.publicKey)).amount,
  );
  assert.equal(buyerSplDelta, bid2Spl);
  assert.equal(escrowSplAfterComplete, 0n);

  const splReversal = {
    escrowSplBeforeUphold: BigInt(escrowSplBeforeUphold),
    bondNative,
    buyerSplAfterComplete: buyerSplDelta,
    escrowSplAfterComplete,
  };

  // ---------- Lot C: pause ----------
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: guardian.publicKey, isSigner: true, isWritable: false },
          { pubkey: configPda, isSigner: false, isWritable: true },
        ],
        Buffer.from([IX.Pause]),
      ),
    ),
    [guardian],
  );

  const lotC = await mintCoreLot(conn, stack, programId, payer, seller, judge, judgeStake, true);
  const tokenC = lotC.tokenId;

  const pauseOpenCode = await expectCustom(
    conn,
    new Transaction().add(
      openAscendingIx({
        programId,
        binding,
        stack,
        seller: seller.publicKey,
        config: configPda,
        asset: lotC.asset,
        passportChallenge: lotC.passportChallenge,
        passportState: lotC.state,
        answers: lotC.answers,
        mayAnswers: standRegistryMayAnswersOpen(lotC.tokenId),
        consignment: lotC.consign,
        custody: custodyPda,
        payer: payer.publicKey,
        stake: sellerStake,
        stakingProgram,
        auction: lotC.auction,
        tokenId: tokenC,
        reserve: RESERVE,
        duration: MIN_DURATION,
        protection: MIN_PROTECTION,
      }),
    ),
    [seller, payer],
    ERR.ContractPaused,
  );

  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: authority.publicKey, isSigner: true, isWritable: false },
          { pubkey: configPda, isSigner: false, isWritable: true },
        ],
        Buffer.from([IX.Unpause]),
      ),
    ),
    [authority],
  );

  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      openAscendingIx({
        programId,
        binding,
        stack,
        seller: seller.publicKey,
        config: configPda,
        asset: lotC.asset,
        passportChallenge: lotC.passportChallenge,
        passportState: lotC.state,
        answers: lotC.answers,
        mayAnswers: standRegistryMayAnswersOpen(lotC.tokenId),
        consignment: lotC.consign,
        custody: custodyPda,
        payer: payer.publicKey,
        stake: sellerStake,
        stakingProgram,
        auction: lotC.auction,
        tokenId: tokenC,
        reserve: RESERVE,
        duration: MIN_DURATION,
        protection: MIN_PROTECTION,
      }),
    ),
    [seller, payer],
  );

  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: guardian.publicKey, isSigner: true, isWritable: false },
          { pubkey: configPda, isSigner: false, isWritable: true },
        ],
        Buffer.from([IX.Pause]),
      ),
    ),
    [guardian],
  );

  const pauseBidCode = await expectCustom(
    conn,
    new Transaction().add(
      bidIx({
        programId,
        bidder: bidder1.publicKey,
        config: configPda,
        consignment: lotC.consign,
        auction: lotC.auction,
        hold: lotC.hold,
        escrow: lotC.escrow,
        payer: payer.publicKey,
        tokenId: tokenC,
        amount: RESERVE,
      }),
    ),
    [bidder1, payer],
    ERR.ContractPaused,
  );

  const buyerOwns = assetAfterSettleOwner.toBase58();
  const assetToSeller = assetAfterRevOwner.toBase58();

  let ixBudgetHeaviest = "Bind";
  let heaviestLegacy = -1;
  for (const [name, row] of Object.entries(ixBudget)) {
    if (row.legacyTx > heaviestLegacy) {
      heaviestLegacy = row.legacyTx;
      ixBudgetHeaviest = name;
    }
  }

  console.warn("\n[svm-stand] Ascending per-ix budget (registry N=2):");
  console.warn(
    "  name".padEnd(28) +
      "accts".padStart(6) +
      "sign".padStart(6) +
      "wrt".padStart(6) +
      "cu".padStart(8) +
      "legacy".padStart(8),
  );
  for (const [name, row] of Object.entries(ixBudget)) {
    console.warn(
      `  ${name.padEnd(26)}` +
        `${String(row.accounts).padStart(6)}` +
        `${String(row.signers).padStart(6)}` +
        `${String(row.writable).padStart(6)}` +
        `${String(row.cu ?? "?").padStart(8)}` +
        `${String(row.legacyTx).padStart(8)}`,
    );
  }
  console.warn(`[svm-stand] heaviest=${ixBudgetHeaviest} legacy=${heaviestLegacy}\n`);

  return withStandArtifactBindings({
    openRefuse: {
      passportNotVerified,
      badDuration,
      protectionOutOfBounds,
      badReserve,
    },
    stubRefuse: { openDirect, setPrice },
    firstBidEndsAt,
    bidRefuse: { fromSeller, tooLow },
    refundDelta,
    settle: {
      auctionClosed,
      holdActive: holdAfterSettle.active,
      buyerOwns,
      escrowDelta: escrowDeltaSettle,
      phase: phaseAfterSettle,
      gross: holdAfterSettle.gross,
    },
    settleRent,
    platformRecipientFamily,
    challengeClock,
    confirmSplit: {
      phase: closedA.phase,
      platformDelta: balP1 - balP0,
      sellerDelta: balS1 - balS0,
      agentDelta: balAgent1 - balAgent0,
      gross: bid2Amt,
      feeBps: closedA.feeBps,
    },
    challengePath: {
      notEligible,
      buyerAsJudge,
      noReversalBeforeUphold,
      reversalPending: holdAfterUphold.reversalPending,
      tUphold,
      abandonmentWindow,
      protectionAfterUphold: holdAfterUphold.protectionEndsAt,
      frozenAfterUphold: holdAfterUphold.frozenRemaining,
      abandonmentAfterUphold: holdAfterUphold.abandonmentDeadline,
      completePhase: phaseAfterRev,
      buyerGrossDelta: balBuyerAfterRev - balBuyerBeforeRev,
      assetToSeller,
    },
    negatives,
    splOutbidClaim,
    splReversal,
    pause: { openCode: pauseOpenCode, bidCode: pauseBidCode },
    ixBudget,
    ixBudgetHeaviest,
  });
}
