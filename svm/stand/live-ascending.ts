/**
 * Local-validator proof: Ascending asset-denomination mode (S6 #4).
 *
 * Asserts chain observations (never ERR/PHASE literals as sole proof):
 * - OpenAscendingDirect with verified + active verifier; PassportNotVerified /
 *   BadDuration / ProtectionOutOfBounds / BadReserve refuses
 * - Stub OpenDirect → AscendingOpenPath; SetPrice → TermsFixed
 * - First bid starts clock; BidFromSeller / BidTooLow; higher bid refunds prev
 * - ForceAuctionEndsAt → Settle: auction closed, hold present, buyer owns asset,
 *   escrow lamports unchanged
 * - Challenge freeze/thaw clock; ConfirmReceipt three-leg split = fee snapshot
 * - Challenge path: NotEligibleChallenger / CannotResolveOwnDispute /
 *   uphold → reversal → completeReversal
 * - Pause: open/bid refuse ContractPaused
 *
 * Requires: local validator, kar_ascending.so + kar_pro_staking + kar_pro_pass.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  testnetMinStakeFloorLamports,
  testnetMinStakeLamports,
} from "../../lib/web3/min-stake-sol.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(__dirname, "../lab/package.json"));
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
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
const RPC = process.env.SVM_STAND_RPC ?? "http://127.0.0.1:8899";
const DEPLOY = path.join(ROOT, "svm/target/deploy");
const CORE_ID = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

const ERR = {
  NotActiveVerifier: 2,
  SourceUnanswerable: 20,
  DisputeActive: 21,
  NotDisputeOpener: 23,
  CannotResolveOwnDispute: 26,
  NotEligibleChallenger: 28,
  CannotRouteBondToJudge: 30,
  WrongPlatformRecipient: 63,
  ShortDelivery: 58,
  TransferFeeExtensionForbidden: 69,
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
} as const;

const PHASE = { Offered: 1, Closed: 2, Returned: 3 } as const;

/** Borsh enum tags — AscendingIx order in ix.rs */
const IX = {
  InitConfig: 0,
  CreateAsset: 1,
  ApproveEscrow: 2,
  SetMayOpen: 3,
  SetVerified: 4,
  SetSelfEncumbrance: 5,
  Grant: 6,
  Revoke: 7,
  OpenDirect: 8,
  OpenFromMandate: 9,
  SetPrice: 10,
  OpenAscendingDirect: 11,
  OpenAscendingFromMandate: 12,
  Bid: 13,
  Settle: 14,
  ConfirmReceipt: 15,
  ReleaseFunds: 16,
  CompleteReversal: 17,
  AbandonReversal: 18,
  OpenChallenge: 19,
  WithdrawChallenge: 20,
  JudgeChallenge: 21,
  ConcludeChallenge: 22,
  ApprovePaymentToken: 23,
  RevokePaymentToken: 24,
  Pause: 25,
  Unpause: 26,
  SetChallengeBond: 27,
  WithdrawClaim: 28,
  ForceAuctionEndsAt: 29,
  ForceHoldClock: 30,
  ForceAssetOwner: 31,
} as const;

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
const AUCTION_SPACE = 123;
const CLAIM_SPACE = 81; // ClaimAccount::SPACE = 8+32+32+8+1
const TOKEN_ACCOUNT_SPACE = 165;
const ABANDONMENT_WINDOW = 30n * 24n * 60n * 60n;

const ASSET_SPACE = 8 + 32 + 32 + 32 + 1; // HarnessAsset::SPACE
const ASSET_VERIFIED_OFF = ASSET_SPACE + 1;

function loadProgramId(name: string): InstanceType<typeof PublicKey> {
  const kpPath = path.join(DEPLOY, `${name}-keypair.json`);
  if (!existsSync(kpPath)) {
    throw new Error(`missing ${kpPath} — build with cargo-build-sbf`);
  }
  const secret = Uint8Array.from(JSON.parse(readFileSync(kpPath, "utf8")));
  return Keypair.fromSecretKey(secret).publicKey;
}

async function airdrop(
  conn: InstanceType<typeof Connection>,
  kp: InstanceType<typeof Keypair>,
  sol = 20,
) {
  const sig = await conn.requestAirdrop(kp.publicKey, sol * 1e9);
  await conn.confirmTransaction(sig, "confirmed");
}

function pda(programId: InstanceType<typeof PublicKey>, seeds: (Buffer | Uint8Array)[]) {
  return PublicKey.findProgramAddressSync(seeds, programId);
}

function ix(
  programId: InstanceType<typeof PublicKey>,
  keys: { pubkey: InstanceType<typeof PublicKey>; isSigner: boolean; isWritable: boolean }[],
  data: Buffer,
) {
  return new TransactionInstruction({ programId, keys, data });
}

function encU16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n, 0);
  return b;
}
function encU64(n: bigint | number): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n), 0);
  return b;
}
function encodeString(s: string): Buffer {
  const body = Buffer.from(s, "utf8");
  const out = Buffer.alloc(4 + body.length);
  out.writeUInt32LE(body.length, 0);
  body.copy(out, 4);
  return out;
}

function customErrCode(e: unknown): number | null {
  const msg = e instanceof Error ? e.message : String(e);
  const m = msg.match(/custom program error: (0x[0-9a-fA-F]+|\d+)/);
  if (!m) return null;
  const raw = m[1]!;
  return raw.startsWith("0x") ? parseInt(raw, 16) : parseInt(raw, 10);
}

async function expectCustom(
  conn: InstanceType<typeof Connection>,
  tx: InstanceType<typeof Transaction>,
  signers: InstanceType<typeof Keypair>[],
  code: number,
): Promise<number> {
  try {
    await sendAndConfirmTransaction(conn, tx, signers, { commitment: "confirmed" });
    assert.fail(`expected custom error ${code}`);
  } catch (e) {
    const got = customErrCode(e);
    assert.equal(got, code, `expected error ${code}, got ${got}: ${e}`);
    return got!;
  }
  throw new Error("unreachable");
}

function readAsset(data: Buffer): {
  owner: InstanceType<typeof PublicKey>;
  verified: boolean;
} {
  const owner = new PublicKey(data.subarray(8 + 32, 8 + 64));
  const verified = data.length > ASSET_VERIFIED_OFF && data[ASSET_VERIFIED_OFF]! !== 0;
  return { owner, verified };
}

function readConsignment(data: Buffer): {
  price: bigint;
  phase: number;
  feeBps: number;
  committed: boolean;
} {
  let o = 8 + 32 + 32 + 32 + 32; // disc + token + seller + agent + asset
  o += 1 + 32; // denom
  o += 8; // floor
  o += 1 + 2; // form + commission
  const feeBps = data.readUInt16LE(o);
  o += 2;
  const price = data.readBigUInt64LE(o);
  o += 8 + 8; // price + opened_at
  const phase = data[o]!;
  const committed = data[o + 1]! !== 0;
  return { price, phase, feeBps, committed };
}

function readAuction(data: Buffer): {
  endsAt: bigint;
  duration: bigint;
  highestBid: bigint;
  highestBidder: InstanceType<typeof PublicKey>;
} {
  let o = 8 + 32; // disc + token
  const duration = data.readBigUInt64LE(o);
  o += 8;
  const endsAt = data.readBigUInt64LE(o);
  o += 8;
  o += 8 * 3; // extension, protection, abandonment
  o += 2; // min_increment_bps
  const highestBidder = new PublicKey(data.subarray(o, o + 32));
  o += 32;
  const highestBid = data.readBigUInt64LE(o);
  return { endsAt, duration, highestBid, highestBidder };
}

function readHold(data: Buffer): {
  buyer: InstanceType<typeof PublicKey>;
  gross: bigint;
  protectionEndsAt: bigint;
  frozenRemaining: bigint;
  reversalPending: boolean;
  abandonmentDeadline: bigint;
  abandonmentWindow: bigint;
  active: boolean;
} {
  let o = 8 + 32; // disc + token
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

async function blockTime(conn: InstanceType<typeof Connection>): Promise<bigint> {
  const slot = await conn.getSlot("confirmed");
  const t = await conn.getBlockTime(slot);
  if (t == null) throw new Error("getBlockTime returned null");
  return BigInt(t);
}

function forceAuctionEndsAtIx(
  programId: InstanceType<typeof PublicKey>,
  authority: InstanceType<typeof PublicKey>,
  config: InstanceType<typeof PublicKey>,
  auction: InstanceType<typeof PublicKey>,
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
  programId: InstanceType<typeof PublicKey>,
  authority: InstanceType<typeof PublicKey>,
  config: InstanceType<typeof PublicKey>,
  hold: InstanceType<typeof PublicKey>,
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

function forceAssetOwnerIx(
  programId: InstanceType<typeof PublicKey>,
  authority: InstanceType<typeof PublicKey>,
  config: InstanceType<typeof PublicKey>,
  asset: InstanceType<typeof PublicKey>,
  tokenId: Buffer,
  owner: InstanceType<typeof PublicKey>,
) {
  return ix(
    programId,
    [
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: asset, isSigner: false, isWritable: true },
    ],
    Buffer.concat([
      Buffer.from([IX.ForceAssetOwner]),
      tokenId,
      Buffer.from(owner.toBytes()),
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
  const [configPda] = pda(programId, [Buffer.from("consign-config")]);
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

async function createAsset(
  conn: InstanceType<typeof Connection>,
  programId: InstanceType<typeof PublicKey>,
  payer: InstanceType<typeof Keypair>,
  seller: InstanceType<typeof Keypair>,
  tokenId: Buffer,
  custodyPda: InstanceType<typeof PublicKey>,
  verified: boolean,
) {
  const [asset] = pda(programId, [Buffer.from("harness-asset"), tokenId]);
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: asset, isSigner: false, isWritable: true },
          { pubkey: seller.publicKey, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        Buffer.concat([Buffer.from([IX.CreateAsset]), tokenId]),
      ),
    ),
    [payer],
  );
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: seller.publicKey, isSigner: true, isWritable: false },
          { pubkey: asset, isSigner: false, isWritable: true },
          { pubkey: custodyPda, isSigner: false, isWritable: false },
        ],
        Buffer.concat([Buffer.from([IX.ApproveEscrow]), tokenId]),
      ),
    ),
    [seller],
  );
  if (verified) {
    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        ix(
          programId,
          [
            { pubkey: payer.publicKey, isSigner: false, isWritable: false },
            { pubkey: asset, isSigner: false, isWritable: true },
          ],
          Buffer.concat([Buffer.from([IX.SetVerified]), tokenId, Buffer.from([1])]),
        ),
      ),
      [payer],
    );
  }
  return asset;
}

function lotPdas(programId: InstanceType<typeof PublicKey>, tokenId: Buffer) {
  const [consignment] = pda(programId, [Buffer.from("consignment"), tokenId]);
  const [auction] = pda(programId, [Buffer.from("auction"), tokenId]);
  const [hold] = pda(programId, [Buffer.from("hold"), tokenId]);
  const [escrow] = pda(programId, [Buffer.from("escrow"), tokenId]);
  const [challenge] = pda(programId, [Buffer.from("challenge"), tokenId]);
  const [custody] = pda(programId, [Buffer.from("custody")]);
  return { consignment, auction, hold, escrow, challenge, custody };
}

function openAscendingIx(args: {
  programId: InstanceType<typeof PublicKey>;
  seller: InstanceType<typeof PublicKey>;
  config: InstanceType<typeof PublicKey>;
  asset: InstanceType<typeof PublicKey>;
  consignment: InstanceType<typeof PublicKey>;
  custody: InstanceType<typeof PublicKey>;
  payer: InstanceType<typeof PublicKey>;
  stake: InstanceType<typeof PublicKey>;
  stakingProgram: InstanceType<typeof PublicKey>;
  auction: InstanceType<typeof PublicKey>;
  tokenId: Buffer;
  reserve: bigint;
  duration: number;
  protection: number;
  /** Native = zeros; SPL = mint pubkey bytes. Optional payment-token PDA when SPL. */
  assetMint?: InstanceType<typeof PublicKey>;
  paymentToken?: InstanceType<typeof PublicKey>;
}) {
  const a = args;
  const mintBuf = a.assetMint ? Buffer.from(a.assetMint.toBytes()) : Buffer.alloc(32, 0);
  const keys = [
    { pubkey: a.seller, isSigner: true, isWritable: false },
    { pubkey: a.config, isSigner: false, isWritable: false },
    { pubkey: a.asset, isSigner: false, isWritable: true },
    { pubkey: a.consignment, isSigner: false, isWritable: true },
    { pubkey: a.custody, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: a.payer, isSigner: true, isWritable: true },
    { pubkey: a.stake, isSigner: false, isWritable: false },
    { pubkey: a.stakingProgram, isSigner: false, isWritable: false },
    { pubkey: a.auction, isSigner: false, isWritable: true },
  ];
  if (a.paymentToken) {
    keys.push({ pubkey: a.paymentToken, isSigner: false, isWritable: false });
  }
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
}> {
  for (const name of ["kar_ascending", "kar_pro_staking", "kar_pro_pass"] as const) {
    if (!existsSync(path.join(DEPLOY, `${name}.so`))) {
      throw new Error(`missing ${name}.so — build stand programs first`);
    }
  }

  const conn = new Connection(opts?.rpc ?? RPC, "confirmed");
  const programId = loadProgramId("kar_ascending");
  const stakingProgram = loadProgramId("kar_pro_staking");
  const passProgram = loadProgramId("kar_pro_pass");

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
  const [custodyPda] = pda(programId, [Buffer.from("custody")]);

  // ---------- Lot A: open refuses + happy path through confirm ----------
  const tokenA = randomTokenId(0xa1);
  const pdasA = lotPdas(programId, tokenA);

  // PassportNotVerified
  const assetUnverified = await createAsset(
    conn,
    programId,
    payer,
    seller,
    tokenA,
    custodyPda,
    false,
  );
  const passportNotVerified = await expectCustom(
    conn,
    new Transaction().add(
      openAscendingIx({
        programId,
        seller: seller.publicKey,
        config: configPda,
        asset: assetUnverified,
        consignment: pdasA.consignment,
        custody: custodyPda,
        payer: payer.publicKey,
        stake: sellerStake,
        stakingProgram,
        auction: pdasA.auction,
        tokenId: tokenA,
        reserve: RESERVE,
        duration: MIN_DURATION,
        protection: MIN_PROTECTION,
      }),
    ),
    [seller, payer],
    ERR.PassportNotVerified,
  );

  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: payer.publicKey, isSigner: false, isWritable: false },
          { pubkey: assetUnverified, isSigner: false, isWritable: true },
        ],
        Buffer.concat([Buffer.from([IX.SetVerified]), tokenA, Buffer.from([1])]),
      ),
    ),
    [payer],
  );

  const badDuration = await expectCustom(
    conn,
    new Transaction().add(
      openAscendingIx({
        programId,
        seller: seller.publicKey,
        config: configPda,
        asset: assetUnverified,
        consignment: pdasA.consignment,
        custody: custodyPda,
        payer: payer.publicKey,
        stake: sellerStake,
        stakingProgram,
        auction: pdasA.auction,
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
        seller: seller.publicKey,
        config: configPda,
        asset: assetUnverified,
        consignment: pdasA.consignment,
        custody: custodyPda,
        payer: payer.publicKey,
        stake: sellerStake,
        stakingProgram,
        auction: pdasA.auction,
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
        seller: seller.publicKey,
        config: configPda,
        asset: assetUnverified,
        consignment: pdasA.consignment,
        custody: custodyPda,
        payer: payer.publicKey,
        stake: sellerStake,
        stakingProgram,
        auction: pdasA.auction,
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
          { pubkey: assetUnverified, isSigner: false, isWritable: true },
          { pubkey: pdasA.consignment, isSigner: false, isWritable: true },
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
          { pubkey: pdasA.consignment, isSigner: false, isWritable: true },
        ],
        Buffer.concat([Buffer.from([IX.SetPrice]), tokenA, encU64(2000)]),
      ),
    ),
    [seller],
    ERR.TermsFixed,
  );

  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      openAscendingIx({
        programId,
        seller: seller.publicKey,
        config: configPda,
        asset: assetUnverified,
        consignment: pdasA.consignment,
        custody: custodyPda,
        payer: payer.publicKey,
        stake: sellerStake,
        stakingProgram,
        auction: pdasA.auction,
        tokenId: tokenA,
        reserve: RESERVE,
        duration: MIN_DURATION,
        protection: MIN_PROTECTION,
      }),
    ),
    [seller, payer],
  );

  const lotOpen = readConsignment((await conn.getAccountInfo(pdasA.consignment))!.data as Buffer);
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
        consignment: pdasA.consignment,
        auction: pdasA.auction,
        hold: pdasA.hold,
        escrow: pdasA.escrow,
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
        consignment: pdasA.consignment,
        auction: pdasA.auction,
        hold: pdasA.hold,
        escrow: pdasA.escrow,
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
        consignment: pdasA.consignment,
        auction: pdasA.auction,
        hold: pdasA.hold,
        escrow: pdasA.escrow,
        payer: payer.publicKey,
        tokenId: tokenA,
        amount: RESERVE,
      }),
    ),
    [bidder1, payer],
  );

  const auctionAfterFirst = readAuction((await conn.getAccountInfo(pdasA.auction))!.data as Buffer);
  assert.ok(auctionAfterFirst.endsAt > 0n, "first bid must start clock");
  const firstBidEndsAt = auctionAfterFirst.endsAt;
  const committed = readConsignment((await conn.getAccountInfo(pdasA.consignment))!.data as Buffer);
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
        consignment: pdasA.consignment,
        auction: pdasA.auction,
        hold: pdasA.hold,
        escrow: pdasA.escrow,
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

  const escrowBeforeSettle = BigInt(await conn.getBalance(pdasA.escrow));
  const auctionBeforeSettleInfo = await conn.getAccountInfo(pdasA.auction);
  const auctionLamportsBefore = BigInt(auctionBeforeSettleInfo?.lamports ?? 0);
  const holdAbsentBefore = (await conn.getAccountInfo(pdasA.hold)) == null;
  assert.ok(holdAbsentBefore);
  const holdRentExempt = BigInt(await conn.getMinimumBalanceForRentExemption(HOLD_SPACE));
  const payerLamportsBeforeSettle = BigInt(await conn.getBalance(payer.publicKey));

  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      forceAuctionEndsAtIx(
        programId,
        authority.publicKey,
        configPda,
        pdasA.auction,
        tokenA,
        1,
      ),
    ),
    [authority],
  );

  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: stranger.publicKey, isSigner: false, isWritable: false },
          { pubkey: pdasA.consignment, isSigner: false, isWritable: false },
          { pubkey: pdasA.auction, isSigner: false, isWritable: true },
          { pubkey: pdasA.hold, isSigner: false, isWritable: true },
          { pubkey: assetUnverified, isSigner: false, isWritable: true },
          { pubkey: pdasA.escrow, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        ],
        Buffer.concat([Buffer.from([IX.Settle]), tokenA]),
      ),
    ),
    [payer],
  );

  const auctionInfoAfter = await conn.getAccountInfo(pdasA.auction);
  const auctionClosed =
    auctionInfoAfter == null ||
    auctionInfoAfter.lamports === 0 ||
    auctionInfoAfter.data.length === 0 ||
    auctionInfoAfter.owner.equals(SystemProgram.programId);
  const holdInfoAfterSettle = await conn.getAccountInfo(pdasA.hold);
  assert.ok(holdInfoAfterSettle);
  const holdLamportsAfter = BigInt(holdInfoAfterSettle!.lamports);
  assert.equal(holdLamportsAfter, holdRentExempt);
  const holdAfterSettle = readHold(holdInfoAfterSettle!.data as Buffer);
  const assetAfterSettle = readAsset((await conn.getAccountInfo(assetUnverified))!.data as Buffer);
  const escrowAfterSettle = BigInt(await conn.getBalance(pdasA.escrow));
  const payerLamportsAfterSettle = BigInt(await conn.getBalance(payer.publicKey));
  const phaseAfterSettle = readConsignment(
    (await conn.getAccountInfo(pdasA.consignment))!.data as Buffer,
  ).phase;
  assert.ok(auctionClosed);
  assert.ok(holdAfterSettle.active);
  assert.equal(assetAfterSettle.owner.toBase58(), bidder2.publicKey.toBase58());
  assert.equal(escrowAfterSettle - escrowBeforeSettle, 0n);
  assert.equal(holdAfterSettle.gross, bid2Amt);
  const settleRent = {
    auctionBefore: auctionLamportsBefore,
    holdAfter: holdLamportsAfter,
    payerDelta: payerLamportsAfterSettle - payerLamportsBeforeSettle,
    holdRentExempt,
  };

  // Challenge freeze / thaw
  const holdBeforeChallenge = readHold((await conn.getAccountInfo(pdasA.hold))!.data as Buffer);
  const tOpen = await blockTime(conn);
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: bidder2.publicKey, isSigner: true, isWritable: true },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: pdasA.consignment, isSigner: false, isWritable: false },
          { pubkey: pdasA.hold, isSigner: false, isWritable: true },
          { pubkey: pdasA.challenge, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        ],
        Buffer.concat([Buffer.from([IX.OpenChallenge]), tokenA]),
      ),
    ),
    [bidder2, payer],
  );
  const holdFrozen = readHold((await conn.getAccountInfo(pdasA.hold))!.data as Buffer);
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
          { pubkey: pdasA.consignment, isSigner: false, isWritable: false },
          { pubkey: pdasA.hold, isSigner: false, isWritable: true },
          { pubkey: pdasA.challenge, isSigner: false, isWritable: true },
        ],
        Buffer.concat([Buffer.from([IX.WithdrawChallenge]), tokenA]),
      ),
    ),
    [bidder2],
  );
  const holdThawed = readHold((await conn.getAccountInfo(pdasA.hold))!.data as Buffer);
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

  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: bidder2.publicKey, isSigner: true, isWritable: false },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: pdasA.consignment, isSigner: false, isWritable: true },
          { pubkey: pdasA.hold, isSigner: false, isWritable: true },
          { pubkey: pdasA.challenge, isSigner: false, isWritable: false },
          { pubkey: pdasA.escrow, isSigner: false, isWritable: true },
          { pubkey: platform.publicKey, isSigner: false, isWritable: true },
          { pubkey: seller.publicKey, isSigner: false, isWritable: true },
          { pubkey: stranger.publicKey, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        ],
        Buffer.concat([Buffer.from([IX.ConfirmReceipt]), tokenA]),
      ),
    ),
    [bidder2, payer],
  );

  const closedA = readConsignment((await conn.getAccountInfo(pdasA.consignment))!.data as Buffer);
  const balP1 = BigInt(await conn.getBalance(platform.publicKey));
  const balS1 = BigInt(await conn.getBalance(seller.publicKey));
  const balAgent1 = BigInt(await conn.getBalance(stranger.publicKey));
  assert.equal(closedA.phase, PHASE.Closed);
  assert.equal(balP1 - balP0, expectedPlatform);
  assert.equal(balS1 - balS0, expectedSeller);
  assert.equal(balAgent1 - balAgent0, 0n);

  // ---------- Lot B: challenge uphold + reversal ----------
  const tokenB = randomTokenId(0xb2);
  const pdasB = lotPdas(programId, tokenB);
  const assetB = await createAsset(conn, programId, payer, seller, tokenB, custodyPda, true);

  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      openAscendingIx({
        programId,
        seller: seller.publicKey,
        config: configPda,
        asset: assetB,
        consignment: pdasB.consignment,
        custody: custodyPda,
        payer: payer.publicKey,
        stake: sellerStake,
        stakingProgram,
        auction: pdasB.auction,
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
        consignment: pdasB.consignment,
        auction: pdasB.auction,
        hold: pdasB.hold,
        escrow: pdasB.escrow,
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
        pdasB.auction,
        tokenB,
        1,
      ),
    ),
    [authority],
  );

  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: stranger.publicKey, isSigner: false, isWritable: false },
          { pubkey: pdasB.consignment, isSigner: false, isWritable: false },
          { pubkey: pdasB.auction, isSigner: false, isWritable: true },
          { pubkey: pdasB.hold, isSigner: false, isWritable: true },
          { pubkey: assetB, isSigner: false, isWritable: true },
          { pubkey: pdasB.escrow, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        ],
        Buffer.concat([Buffer.from([IX.Settle]), tokenB]),
      ),
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
          { pubkey: pdasB.consignment, isSigner: false, isWritable: false },
          { pubkey: pdasB.hold, isSigner: false, isWritable: true },
          { pubkey: pdasB.challenge, isSigner: false, isWritable: true },
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
          { pubkey: pdasB.consignment, isSigner: false, isWritable: false },
          { pubkey: pdasB.hold, isSigner: false, isWritable: true },
          { pubkey: pdasB.challenge, isSigner: false, isWritable: true },
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
        [
          { pubkey: bidder1.publicKey, isSigner: true, isWritable: true },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: pdasB.consignment, isSigner: false, isWritable: true },
          { pubkey: pdasB.hold, isSigner: false, isWritable: true },
          { pubkey: assetB, isSigner: false, isWritable: true },
          { pubkey: pdasB.escrow, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        ],
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
        [
          { pubkey: bidder1.publicKey, isSigner: true, isWritable: false },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: pdasB.consignment, isSigner: false, isWritable: true },
          { pubkey: pdasB.hold, isSigner: false, isWritable: true },
          { pubkey: pdasB.challenge, isSigner: false, isWritable: true },
          { pubkey: bidder1.publicKey, isSigner: false, isWritable: true },
          { pubkey: bidder1Stake, isSigner: false, isWritable: false },
          { pubkey: stakingProgram, isSigner: false, isWritable: false },
          { pubkey: pdasB.escrow, isSigner: false, isWritable: true },
          { pubkey: platform.publicKey, isSigner: false, isWritable: true },
          { pubkey: seller.publicKey, isSigner: false, isWritable: true },
          { pubkey: stranger.publicKey, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        ],
        Buffer.concat([Buffer.from([IX.JudgeChallenge]), tokenB, Buffer.from([0])]),
      ),
    ),
    [bidder1, payer],
    ERR.CannotResolveOwnDispute,
  );

  const holdBeforeUphold = readHold((await conn.getAccountInfo(pdasB.hold))!.data as Buffer);
  const abandonmentWindow = holdBeforeUphold.abandonmentWindow;
  assert.equal(abandonmentWindow, ABANDONMENT_WINDOW);
  const tUphold = await blockTime(conn);
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: judge.publicKey, isSigner: true, isWritable: false },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: pdasB.consignment, isSigner: false, isWritable: true },
          { pubkey: pdasB.hold, isSigner: false, isWritable: true },
          { pubkey: pdasB.challenge, isSigner: false, isWritable: true },
          { pubkey: bidder1.publicKey, isSigner: false, isWritable: true }, // bond → challenger on uphold
          { pubkey: judgeStake, isSigner: false, isWritable: false },
          { pubkey: stakingProgram, isSigner: false, isWritable: false },
          { pubkey: pdasB.escrow, isSigner: false, isWritable: true },
          { pubkey: platform.publicKey, isSigner: false, isWritable: true },
          { pubkey: seller.publicKey, isSigner: false, isWritable: true },
          { pubkey: stranger.publicKey, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        ],
        Buffer.concat([Buffer.from([IX.JudgeChallenge]), tokenB, Buffer.from([0])]), // Upheld
      ),
    ),
    [judge, payer],
  );

  const holdAfterUphold = readHold((await conn.getAccountInfo(pdasB.hold))!.data as Buffer);
  assert.equal(holdAfterUphold.reversalPending, true);
  assert.equal(holdAfterUphold.protectionEndsAt, 0n);
  assert.equal(holdAfterUphold.frozenRemaining, 0n);
  assert.ok(holdAfterUphold.abandonmentDeadline > 0n);

  const balBuyerBeforeRev = BigInt(await conn.getBalance(bidder1.publicKey));
  const balEscrowBeforeRev = BigInt(await conn.getBalance(pdasB.escrow));
  {
    const tx = new Transaction().add(
      ix(
        programId,
        [
          { pubkey: bidder1.publicKey, isSigner: true, isWritable: true },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: pdasB.consignment, isSigner: false, isWritable: true },
          { pubkey: pdasB.hold, isSigner: false, isWritable: true },
          { pubkey: assetB, isSigner: false, isWritable: true },
          { pubkey: pdasB.escrow, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        ],
        Buffer.concat([Buffer.from([IX.CompleteReversal]), tokenB]),
      ),
    );
    tx.feePayer = payer.publicKey;
    await sendAndConfirmTransaction(conn, tx, [payer, bidder1], { commitment: "confirmed" });
  }
  const balBuyerAfterRev = BigInt(await conn.getBalance(bidder1.publicKey));
  const balEscrowAfterRev = BigInt(await conn.getBalance(pdasB.escrow));
  const assetAfterRev = readAsset((await conn.getAccountInfo(assetB))!.data as Buffer);
  const phaseAfterRev = readConsignment(
    (await conn.getAccountInfo(pdasB.consignment))!.data as Buffer,
  ).phase;
  assert.equal(phaseAfterRev, PHASE.Returned);
  assert.equal(assetAfterRev.owner.toBase58(), seller.publicKey.toBase58());
  assert.equal(balBuyerAfterRev - balBuyerBeforeRev, RESERVE);
  assert.equal(balEscrowBeforeRev - balEscrowAfterRev, RESERVE);

  // ---------- Negatives (expectCustom each name) ----------
  const negatives: Record<string, number> = {};

  async function openBidForceSettle(tokenId: Buffer, asset: InstanceType<typeof PublicKey>, buyer: InstanceType<typeof Keypair>) {
    const pdas = lotPdas(programId, tokenId);
    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        openAscendingIx({
          programId,
          seller: seller.publicKey,
          config: configPda,
          asset,
          consignment: pdas.consignment,
          custody: custodyPda,
          payer: payer.publicKey,
          stake: sellerStake,
          stakingProgram,
          auction: pdas.auction,
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
          consignment: pdas.consignment,
          auction: pdas.auction,
          hold: pdas.hold,
          escrow: pdas.escrow,
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
        forceAuctionEndsAtIx(programId, authority.publicKey, configPda, pdas.auction, tokenId, 1),
      ),
      [authority],
    );
    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        ix(
          programId,
          [
            { pubkey: stranger.publicKey, isSigner: false, isWritable: false },
            { pubkey: pdas.consignment, isSigner: false, isWritable: false },
            { pubkey: pdas.auction, isSigner: false, isWritable: true },
            { pubkey: pdas.hold, isSigner: false, isWritable: true },
            { pubkey: asset, isSigner: false, isWritable: true },
            { pubkey: pdas.escrow, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          ],
          Buffer.concat([Buffer.from([IX.Settle]), tokenId]),
        ),
      ),
      [payer],
    );
    return pdas;
  }

  function confirmKeys(
    buyerPk: InstanceType<typeof PublicKey>,
    pdas: ReturnType<typeof lotPdas>,
    platformPk: InstanceType<typeof PublicKey>,
  ) {
    return [
      { pubkey: buyerPk, isSigner: true, isWritable: false },
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: pdas.consignment, isSigner: false, isWritable: true },
      { pubkey: pdas.hold, isSigner: false, isWritable: true },
      { pubkey: pdas.challenge, isSigner: false, isWritable: false },
      { pubkey: pdas.escrow, isSigner: false, isWritable: true },
      { pubkey: platformPk, isSigner: false, isWritable: true },
      { pubkey: seller.publicKey, isSigner: false, isWritable: true },
      { pubkey: stranger.publicKey, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    ];
  }

  function releaseKeys(pdas: ReturnType<typeof lotPdas>) {
    return [
      { pubkey: stranger.publicKey, isSigner: false, isWritable: false },
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: pdas.consignment, isSigner: false, isWritable: true },
      { pubkey: pdas.hold, isSigner: false, isWritable: true },
      { pubkey: pdas.challenge, isSigner: false, isWritable: false },
      { pubkey: pdas.escrow, isSigner: false, isWritable: true },
      { pubkey: platform.publicKey, isSigner: false, isWritable: true },
      { pubkey: seller.publicKey, isSigner: false, isWritable: true },
      { pubkey: stranger.publicKey, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    ];
  }

  // Open refuses: inactive stake / wrong stake answer
  {
    const tokenN = randomTokenId(0xd1);
    const pdasN = lotPdas(programId, tokenN);
    // Inactive verifier owns asset so stake PDA wallet matches runner
    const assetN = await createAsset(
      conn,
      programId,
      payer,
      inactiveVerifier,
      tokenN,
      custodyPda,
      true,
    );
    negatives.NotActiveVerifierOpen = await expectCustom(
      conn,
      new Transaction().add(
        openAscendingIx({
          programId,
          seller: inactiveVerifier.publicKey,
          config: configPda,
          asset: assetN,
          consignment: pdasN.consignment,
          custody: custodyPda,
          payer: payer.publicKey,
          stake: inactiveStake,
          stakingProgram,
          auction: pdasN.auction,
          tokenId: tokenN,
          reserve: RESERVE,
          duration: MIN_DURATION,
          protection: MIN_PROTECTION,
        }),
      ),
      [inactiveVerifier, payer],
      ERR.NotActiveVerifier,
    );
    const tokenN2 = randomTokenId(0xd11);
    const pdasN2 = lotPdas(programId, tokenN2);
    const assetN2 = await createAsset(conn, programId, payer, seller, tokenN2, custodyPda, true);
    negatives.SourceUnanswerableOpen = await expectCustom(
      conn,
      new Transaction().add(
        openAscendingIx({
          programId,
          seller: seller.publicKey,
          config: configPda,
          asset: assetN2,
          consignment: pdasN2.consignment,
          custody: custodyPda,
          payer: payer.publicKey,
          stake: SystemProgram.programId,
          stakingProgram,
          auction: pdasN2.auction,
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
    const tokenN = randomTokenId(0xd2);
    const pdasN = lotPdas(programId, tokenN);
    const assetN = await createAsset(conn, programId, payer, seller, tokenN, custodyPda, true);
    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        openAscendingIx({
          programId,
          seller: seller.publicKey,
          config: configPda,
          asset: assetN,
          consignment: pdasN.consignment,
          custody: custodyPda,
          payer: payer.publicKey,
          stake: sellerStake,
          stakingProgram,
          auction: pdasN.auction,
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
          consignment: pdasN.consignment,
          auction: pdasN.auction,
          hold: pdasN.hold,
          escrow: pdasN.escrow,
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
        ix(
          programId,
          [
            { pubkey: stranger.publicKey, isSigner: false, isWritable: false },
            { pubkey: pdasN.consignment, isSigner: false, isWritable: false },
            { pubkey: pdasN.auction, isSigner: false, isWritable: true },
            { pubkey: pdasN.hold, isSigner: false, isWritable: true },
            { pubkey: assetN, isSigner: false, isWritable: true },
            { pubkey: pdasN.escrow, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          ],
          Buffer.concat([Buffer.from([IX.Settle]), tokenN]),
        ),
      ),
      [payer],
      ERR.AuctionNotEnded,
    );
    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        forceAuctionEndsAtIx(programId, authority.publicKey, configPda, pdasN.auction, tokenN, 1),
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
          consignment: pdasN.consignment,
          auction: pdasN.auction,
          hold: pdasN.hold,
          escrow: pdasN.escrow,
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
        ix(
          programId,
          [
            { pubkey: stranger.publicKey, isSigner: false, isWritable: false },
            { pubkey: pdasN.consignment, isSigner: false, isWritable: false },
            { pubkey: pdasN.auction, isSigner: false, isWritable: true },
            { pubkey: pdasN.hold, isSigner: false, isWritable: true },
            { pubkey: assetN, isSigner: false, isWritable: true },
            { pubkey: pdasN.escrow, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          ],
          Buffer.concat([Buffer.from([IX.Settle]), tokenN]),
        ),
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
          consignment: pdasN.consignment,
          auction: pdasN.auction,
          hold: pdasN.hold,
          escrow: pdasN.escrow,
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
        ix(
          programId,
          [
            { pubkey: stranger.publicKey, isSigner: false, isWritable: false },
            { pubkey: pdasN.consignment, isSigner: false, isWritable: false },
            { pubkey: pdasN.auction, isSigner: false, isWritable: true },
            { pubkey: pdasN.hold, isSigner: false, isWritable: true },
            { pubkey: assetN, isSigner: false, isWritable: true },
            { pubkey: pdasN.escrow, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          ],
          Buffer.concat([Buffer.from([IX.Settle]), tokenN]),
        ),
      ),
      [payer],
      ERR.SettlementPending,
    );
    negatives.HoldNotReady = await expectCustom(
      conn,
      new Transaction().add(
        ix(programId, releaseKeys(pdasN), Buffer.concat([Buffer.from([IX.ReleaseFunds]), tokenN])),
      ),
      [payer],
      ERR.HoldNotReady,
    );
  }

  // Hold-path negatives on a dedicated lot
  {
    const tokenN = randomTokenId(0xd3);
    const assetN = await createAsset(conn, programId, payer, seller, tokenN, custodyPda, true);
    const pdasN = await openBidForceSettle(tokenN, assetN, bidder1);

    negatives.NotHoldBuyerConfirm = await expectCustom(
      conn,
      new Transaction().add(
        ix(
          programId,
          confirmKeys(stranger.publicKey, pdasN, platform.publicKey),
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
            { pubkey: pdasN.consignment, isSigner: false, isWritable: false },
            { pubkey: pdasN.hold, isSigner: false, isWritable: true },
            { pubkey: pdasN.challenge, isSigner: false, isWritable: true },
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
          confirmKeys(bidder1.publicKey, pdasN, platform.publicKey),
          Buffer.concat([Buffer.from([IX.ConfirmReceipt]), tokenN]),
        ),
      ),
      [bidder1, payer],
      ERR.DisputeActive,
    );
    negatives.DisputeActiveRelease = await expectCustom(
      conn,
      new Transaction().add(
        ix(programId, releaseKeys(pdasN), Buffer.concat([Buffer.from([IX.ReleaseFunds]), tokenN])),
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
            { pubkey: pdasN.consignment, isSigner: false, isWritable: false },
            { pubkey: pdasN.hold, isSigner: false, isWritable: true },
            { pubkey: pdasN.challenge, isSigner: false, isWritable: true },
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
          [
            { pubkey: inactiveVerifier.publicKey, isSigner: true, isWritable: false },
            { pubkey: configPda, isSigner: false, isWritable: false },
            { pubkey: pdasN.consignment, isSigner: false, isWritable: true },
            { pubkey: pdasN.hold, isSigner: false, isWritable: true },
            { pubkey: pdasN.challenge, isSigner: false, isWritable: true },
            { pubkey: bidder1.publicKey, isSigner: false, isWritable: true },
            { pubkey: inactiveStake, isSigner: false, isWritable: false },
            { pubkey: stakingProgram, isSigner: false, isWritable: false },
            { pubkey: pdasN.escrow, isSigner: false, isWritable: true },
            { pubkey: platform.publicKey, isSigner: false, isWritable: true },
            { pubkey: seller.publicKey, isSigner: false, isWritable: true },
            { pubkey: stranger.publicKey, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          ],
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
          [
            { pubkey: judge.publicKey, isSigner: true, isWritable: false },
            { pubkey: configPda, isSigner: false, isWritable: false },
            { pubkey: pdasN.consignment, isSigner: false, isWritable: true },
            { pubkey: pdasN.hold, isSigner: false, isWritable: true },
            { pubkey: pdasN.challenge, isSigner: false, isWritable: true },
            { pubkey: bidder1.publicKey, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: stakingProgram, isSigner: false, isWritable: false },
            { pubkey: pdasN.escrow, isSigner: false, isWritable: true },
            { pubkey: platform.publicKey, isSigner: false, isWritable: true },
            { pubkey: seller.publicKey, isSigner: false, isWritable: true },
            { pubkey: stranger.publicKey, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          ],
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
          [
            { pubkey: seller.publicKey, isSigner: true, isWritable: false },
            { pubkey: configPda, isSigner: false, isWritable: false },
            { pubkey: pdasN.consignment, isSigner: false, isWritable: true },
            { pubkey: pdasN.hold, isSigner: false, isWritable: true },
            { pubkey: pdasN.challenge, isSigner: false, isWritable: true },
            { pubkey: bidder1.publicKey, isSigner: false, isWritable: true },
            { pubkey: sellerStake, isSigner: false, isWritable: false },
            { pubkey: stakingProgram, isSigner: false, isWritable: false },
            { pubkey: pdasN.escrow, isSigner: false, isWritable: true },
            { pubkey: platform.publicKey, isSigner: false, isWritable: true },
            { pubkey: seller.publicKey, isSigner: false, isWritable: true },
            { pubkey: stranger.publicKey, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          ],
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
          [
            { pubkey: forfeit.publicKey, isSigner: true, isWritable: false },
            { pubkey: configPda, isSigner: false, isWritable: false },
            { pubkey: pdasN.consignment, isSigner: false, isWritable: true },
            { pubkey: pdasN.hold, isSigner: false, isWritable: true },
            { pubkey: pdasN.challenge, isSigner: false, isWritable: true },
            { pubkey: forfeit.publicKey, isSigner: false, isWritable: true },
            { pubkey: forfeitStake, isSigner: false, isWritable: false },
            { pubkey: stakingProgram, isSigner: false, isWritable: false },
            { pubkey: pdasN.escrow, isSigner: false, isWritable: true },
            { pubkey: platform.publicKey, isSigner: false, isWritable: true },
            { pubkey: seller.publicKey, isSigner: false, isWritable: true },
            { pubkey: stranger.publicKey, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          ],
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
          [
            { pubkey: judge.publicKey, isSigner: true, isWritable: false },
            { pubkey: configPda, isSigner: false, isWritable: false },
            { pubkey: pdasN.consignment, isSigner: false, isWritable: true },
            { pubkey: pdasN.hold, isSigner: false, isWritable: true },
            { pubkey: pdasN.challenge, isSigner: false, isWritable: true },
            { pubkey: bidder1.publicKey, isSigner: false, isWritable: true },
            { pubkey: judgeStake, isSigner: false, isWritable: false },
            { pubkey: stakingProgram, isSigner: false, isWritable: false },
            { pubkey: pdasN.escrow, isSigner: false, isWritable: true },
            { pubkey: platform.publicKey, isSigner: false, isWritable: true },
            { pubkey: seller.publicKey, isSigner: false, isWritable: true },
            { pubkey: stranger.publicKey, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          ],
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
          confirmKeys(bidder1.publicKey, pdasN, platform.publicKey),
          Buffer.concat([Buffer.from([IX.ConfirmReceipt]), tokenN]),
        ),
      ),
      [bidder1, payer],
      ERR.ReversalPending,
    );
    negatives.ReversalPendingRelease = await expectCustom(
      conn,
      new Transaction().add(
        ix(programId, releaseKeys(pdasN), Buffer.concat([Buffer.from([IX.ReleaseFunds]), tokenN])),
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
            { pubkey: pdasN.consignment, isSigner: false, isWritable: false },
            { pubkey: pdasN.hold, isSigner: false, isWritable: true },
            { pubkey: pdasN.challenge, isSigner: false, isWritable: true },
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
          [
            { pubkey: stranger.publicKey, isSigner: false, isWritable: false },
            { pubkey: configPda, isSigner: false, isWritable: false },
            { pubkey: pdasN.consignment, isSigner: false, isWritable: true },
            { pubkey: pdasN.hold, isSigner: false, isWritable: true },
            { pubkey: pdasN.escrow, isSigner: false, isWritable: true },
            { pubkey: platform.publicKey, isSigner: false, isWritable: true },
            { pubkey: seller.publicKey, isSigner: false, isWritable: true },
            { pubkey: stranger.publicKey, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          ],
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
          [
            { pubkey: stranger.publicKey, isSigner: true, isWritable: true },
            { pubkey: configPda, isSigner: false, isWritable: false },
            { pubkey: pdasN.consignment, isSigner: false, isWritable: true },
            { pubkey: pdasN.hold, isSigner: false, isWritable: true },
            { pubkey: assetN, isSigner: false, isWritable: true },
            { pubkey: pdasN.escrow, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          ],
          Buffer.concat([Buffer.from([IX.CompleteReversal]), tokenN]),
        ),
      ),
      [stranger, payer],
      ERR.NotHoldBuyer,
    );
    // Force asset away from buyer → NotPassportHolder on Complete
    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        forceAssetOwnerIx(
          programId,
          authority.publicKey,
          configPda,
          assetN,
          tokenN,
          stranger.publicKey,
        ),
      ),
      [authority],
    );
    negatives.NotPassportHolder = await expectCustom(
      conn,
      new Transaction().add(
        ix(
          programId,
          [
            { pubkey: bidder1.publicKey, isSigner: true, isWritable: true },
            { pubkey: configPda, isSigner: false, isWritable: false },
            { pubkey: pdasN.consignment, isSigner: false, isWritable: true },
            { pubkey: pdasN.hold, isSigner: false, isWritable: true },
            { pubkey: assetN, isSigner: false, isWritable: true },
            { pubkey: pdasN.escrow, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          ],
          Buffer.concat([Buffer.from([IX.CompleteReversal]), tokenN]),
        ),
      ),
      [bidder1, payer],
      ERR.NotPassportHolder,
    );
  }

  // ProtectionElapsed / WrongPlatformRecipient / NoHold / BidFromAgent
  {
    const tokenN = randomTokenId(0xd4);
    const assetN = await createAsset(conn, programId, payer, seller, tokenN, custodyPda, true);
    const pdasN = await openBidForceSettle(tokenN, assetN, bidder2);
    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        forceHoldClockIx(programId, authority.publicKey, configPda, pdasN.hold, tokenN, 1, 0, 0),
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
            { pubkey: pdasN.consignment, isSigner: false, isWritable: false },
            { pubkey: pdasN.hold, isSigner: false, isWritable: true },
            { pubkey: pdasN.challenge, isSigner: false, isWritable: true },
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
          pdasN.hold,
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
          confirmKeys(bidder2.publicKey, pdasN, stranger.publicKey),
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
          confirmKeys(bidder2.publicKey, pdasN, platform.publicKey),
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
          confirmKeys(bidder2.publicKey, pdasN, platform.publicKey),
          Buffer.concat([Buffer.from([IX.ConfirmReceipt]), tokenN]),
        ),
      ),
      [bidder2, payer],
      ERR.NoHold,
    );
  }

  // BidFromAgent via Grant + OpenAscendingFromMandate
  {
    const tokenN = randomTokenId(0xd5);
    const pdasN = lotPdas(programId, tokenN);
    const assetN = await createAsset(conn, programId, payer, seller, tokenN, custodyPda, true);
    const [mandateN] = pda(programId, [Buffer.from("mandate"), tokenN]);
    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        ix(
          programId,
          [
            { pubkey: seller.publicKey, isSigner: true, isWritable: false },
            { pubkey: assetN, isSigner: false, isWritable: false },
            { pubkey: mandateN, isSigner: false, isWritable: true },
            { pubkey: pdasN.consignment, isSigner: false, isWritable: false },
            { pubkey: custodyPda, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          ],
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
          [
            { pubkey: agent.publicKey, isSigner: true, isWritable: false },
            { pubkey: configPda, isSigner: false, isWritable: false },
            { pubkey: assetN, isSigner: false, isWritable: true },
            { pubkey: mandateN, isSigner: false, isWritable: false },
            { pubkey: pdasN.consignment, isSigner: false, isWritable: true },
            { pubkey: custodyPda, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
            { pubkey: agentStake, isSigner: false, isWritable: false },
            { pubkey: stakingProgram, isSigner: false, isWritable: false },
            { pubkey: pdasN.auction, isSigner: false, isWritable: true },
          ],
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
          consignment: pdasN.consignment,
          auction: pdasN.auction,
          hold: pdasN.hold,
          escrow: pdasN.escrow,
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
  const [payTok] = pda(programId, [Buffer.from("payment-token"), mint.publicKey.toBuffer()]);
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

  const tokenS = randomTokenId(0xe1);
  const pdasS = lotPdas(programId, tokenS);
  const assetS = await createAsset(conn, programId, payer, seller, tokenS, custodyPda, true);
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      openAscendingIx({
        programId,
        seller: seller.publicKey,
        config: configPda,
        asset: assetS,
        consignment: pdasS.consignment,
        custody: custodyPda,
        payer: payer.publicKey,
        stake: sellerStake,
        stakingProgram,
        auction: pdasS.auction,
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
      createInitializeAccount3Instruction(escrowAta.publicKey, mint.publicKey, pdasS.escrow),
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
        consignment: pdasS.consignment,
        auction: pdasS.auction,
        hold: pdasS.hold,
        escrow: pdasS.escrow,
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
        consignment: pdasS.consignment,
        auction: pdasS.auction,
        hold: pdasS.hold,
        escrow: pdasS.escrow,
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
      forceAuctionEndsAtIx(programId, authority.publicKey, configPda, pdasS.auction, tokenS, 1),
    ),
    [authority],
  );
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: stranger.publicKey, isSigner: false, isWritable: false },
          { pubkey: pdasS.consignment, isSigner: false, isWritable: false },
          { pubkey: pdasS.auction, isSigner: false, isWritable: true },
          { pubkey: pdasS.hold, isSigner: false, isWritable: true },
          { pubkey: assetS, isSigner: false, isWritable: true },
          { pubkey: pdasS.escrow, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: escrowAta.publicKey, isSigner: false, isWritable: false },
        ],
        Buffer.concat([Buffer.from([IX.Settle]), tokenS]),
      ),
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
          { pubkey: pdasS.consignment, isSigner: false, isWritable: false },
          { pubkey: pdasS.hold, isSigner: false, isWritable: true },
          { pubkey: pdasS.challenge, isSigner: false, isWritable: true },
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
        [
          { pubkey: judge.publicKey, isSigner: true, isWritable: false },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: pdasS.consignment, isSigner: false, isWritable: true },
          { pubkey: pdasS.hold, isSigner: false, isWritable: true },
          { pubkey: pdasS.challenge, isSigner: false, isWritable: true },
          { pubkey: bidder2.publicKey, isSigner: false, isWritable: true },
          { pubkey: judgeStake, isSigner: false, isWritable: false },
          { pubkey: stakingProgram, isSigner: false, isWritable: false },
          { pubkey: pdasS.escrow, isSigner: false, isWritable: true },
          { pubkey: platform.publicKey, isSigner: false, isWritable: true },
          { pubkey: seller.publicKey, isSigner: false, isWritable: true },
          { pubkey: stranger.publicKey, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        ],
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
        [
          { pubkey: bidder2.publicKey, isSigner: true, isWritable: true },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: pdasS.consignment, isSigner: false, isWritable: true },
          { pubkey: pdasS.hold, isSigner: false, isWritable: true },
          { pubkey: assetS, isSigner: false, isWritable: true },
          { pubkey: pdasS.escrow, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: bidder2Ata.publicKey, isSigner: false, isWritable: true },
          { pubkey: escrowAta.publicKey, isSigner: false, isWritable: true },
          { pubkey: mint.publicKey, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: buyer2Claim, isSigner: false, isWritable: true },
          { pubkey: buyer2ClaimAta, isSigner: false, isWritable: true },
        ],
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

  const tokenC = randomTokenId(0xc3);
  const pdasC = lotPdas(programId, tokenC);
  const assetC = await createAsset(conn, programId, payer, seller, tokenC, custodyPda, true);

  const pauseOpenCode = await expectCustom(
    conn,
    new Transaction().add(
      openAscendingIx({
        programId,
        seller: seller.publicKey,
        config: configPda,
        asset: assetC,
        consignment: pdasC.consignment,
        custody: custodyPda,
        payer: payer.publicKey,
        stake: sellerStake,
        stakingProgram,
        auction: pdasC.auction,
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
        seller: seller.publicKey,
        config: configPda,
        asset: assetC,
        consignment: pdasC.consignment,
        custody: custodyPda,
        payer: payer.publicKey,
        stake: sellerStake,
        stakingProgram,
        auction: pdasC.auction,
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
        consignment: pdasC.consignment,
        auction: pdasC.auction,
        hold: pdasC.hold,
        escrow: pdasC.escrow,
        payer: payer.publicKey,
        tokenId: tokenC,
        amount: RESERVE,
      }),
    ),
    [bidder1, payer],
    ERR.ContractPaused,
  );

  const buyerOwns = assetAfterSettle.owner.toBase58();
  const assetToSeller = assetAfterRev.owner.toBase58();

  return {
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
      escrowDelta: escrowAfterSettle - escrowBeforeSettle,
      phase: phaseAfterSettle,
      gross: holdAfterSettle.gross,
    },
    settleRent,
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
  };
}
