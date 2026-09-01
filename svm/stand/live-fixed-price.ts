/**
 * Local-validator proof: FixedPrice asset + fiat (S6 #5).
 *
 * Asserts chain state (never success-only / invented return constants):
 * - Native buy: pull → buyer owns asset → three-leg deltas = fee snapshot split
 * - SPL buy + soft-revoke then buy still settles (D-31)
 * - Transfer-fee mint refused at admission (TransferFeeExtensionForbidden)
 * - Conforming mint: PaymentTokenRecord.decimals == mint decimals from chain
 * - SPL buy: escrow ATA receives full price (delivery measure on program path)
 * - External confirm: custody to buyer; platform/seller/agent/escrow unchanged (D-32)
 * - Pause: open+buy refuse (ContractPaused); external confirm still works
 * - Native Fiat open → CurrencyNotAvailableOnChain (no native USD feed on config)
 * - SPL Fiat without feed → PaymentTokenFeedRequired
 * - SPL Fiat with lab price account: fresh buy converts; stale/wide/bad refuse by name
 * - Agented Margin fiat: Grant → OpenFromMandate → ForceSeed → Buy rewrites floor (D-27)
 *   to asset units; Margin owner leg = rewritten floor; three-leg split conserves amount
 *
 * Requires: local validator, kar_fixed_price.so preloaded or deployable.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { withStandArtifactBindings } from "./stand-artifact-bindings.ts";

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
  TOKEN_2022_PROGRAM_ID,
  createInitializeMint2Instruction,
  createInitializeAccount3Instruction,
  createMintToInstruction,
  createInitializeTransferFeeConfigInstruction,
  getMintLen,
  ExtensionType,
  getAccount,
  getMinimumBalanceForRentExemptMint,
  getMinimumBalanceForRentExemptAccount,
} = require("@solana/spl-token") as typeof import("@solana/spl-token");

const ROOT = path.resolve(__dirname, "../..");
const RPC = process.env.SVM_STAND_RPC ?? "http://127.0.0.1:8899";
const DEPLOY = path.join(ROOT, "svm/target/deploy");

const ERR = {
  ContractPaused: 76,
  TransferFeeExtensionForbidden: 69,
  CurrencyNotAvailableOnChain: 133,
  PaymentTokenFeedRequired: 124,
  StalePrice: 122,
  BadOracleAnswer: 123,
  ConfidenceTooWide: 131,
} as const;

const PHASE = { Offered: 1, Closed: 2 } as const;

/** Borsh enum tags — FixedPriceIx order in ix.rs */
const IX = {
  InitConfig: 0,
  CreateAsset: 1,
  ApproveEscrow: 2,
  SetMayOpen: 3,
  SetSelfEncumbrance: 4,
  Grant: 5,
  Revoke: 6,
  OpenDirect: 7,
  OpenFromMandate: 8,
  Pause: 17,
  Unpause: 18,
  ApprovePaymentToken: 19,
  RevokePaymentToken: 20,
  Buy: 21,
  SetSettlementNote: 22,
  ConfirmExternalPayment: 23,
  ForceSeedPriceAccount: 26,
} as const;

/** Margin form ordinal — CompensationForm::Margin in consignment-base. */
const FORM_MARGIN = 0;
/** Fiat denomination ordinal. */
const DENOM_FIAT = 1;

const FIXTURES = path.join(ROOT, "svm/lab/fixtures/price-measure");
const LAB_FEED_ID = Buffer.from(
  "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
  "hex",
);
const CURRENCY_USD = Buffer.concat([Buffer.from("USD"), Buffer.alloc(29)]);

function loadProgramId(): InstanceType<typeof PublicKey> {
  const kpPath = path.join(DEPLOY, "kar_fixed_price-keypair.json");
  if (!existsSync(kpPath)) {
    throw new Error(`missing ${kpPath} — build kar-fixed-price with cargo-build-sbf`);
  }
  const secret = Uint8Array.from(JSON.parse(readFileSync(kpPath, "utf8")));
  return Keypair.fromSecretKey(secret).publicKey;
}

async function airdrop(conn: InstanceType<typeof Connection>, kp: InstanceType<typeof Keypair>, sol = 20) {
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
function encU32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n, 0);
  return b;
}
function encU64(n: bigint | number): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n), 0);
  return b;
}
function encI64(n: bigint | number): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(BigInt(n), 0);
  return b;
}

/** Asset-only admit (zeros feed). */
function encApproveAssetOnly(): Buffer {
  return Buffer.concat([
    Buffer.from([IX.ApprovePaymentToken]),
    Buffer.alloc(32, 0),
    Buffer.alloc(32, 0),
    encU32(0),
    encU32(0),
  ]);
}

/** Fiat-capable admit — pin FP program as price_program for lab ForceSeed. */
function encApproveWithFeed(
  priceProgram: InstanceType<typeof PublicKey>,
  feedId: Buffer,
  staleness: number,
  maxConfBps: number,
): Buffer {
  return Buffer.concat([
    Buffer.from([IX.ApprovePaymentToken]),
    priceProgram.toBuffer(),
    feedId,
    encU32(staleness),
    encU32(maxConfBps),
  ]);
}

function patchPublishTime(bin: Buffer, unix: number): Buffer {
  const out = Buffer.from(bin);
  encI64(unix).copy(out, 93);
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

function readAsset(data: Buffer): { owner: InstanceType<typeof PublicKey> } {
  const owner = new PublicKey(data.subarray(8 + 32, 8 + 64));
  return { owner };
}

function readConsignment(data: Buffer): {
  price: bigint;
  phase: number;
  feeBps: number;
  floor: bigint;
} {
  let o = 8 + 32 + 32 + 32 + 32; // disc + token + seller + agent + asset
  o += 1 + 32; // denom
  const floor = data.readBigUInt64LE(o);
  o += 8;
  o += 1 + 2; // form + commission
  const feeBps = data.readUInt16LE(o);
  o += 2;
  const price = data.readBigUInt64LE(o);
  o += 8 + 8;
  const phase = data[o]!;
  return { price, phase, feeBps, floor };
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

async function initMode(
  conn: InstanceType<typeof Connection>,
  programId: InstanceType<typeof PublicKey>,
  payer: InstanceType<typeof Keypair>,
  authority: InstanceType<typeof Keypair>,
  platform: InstanceType<typeof Keypair>,
  guardian: InstanceType<typeof Keypair>,
  feeBps: number,
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
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        Buffer.concat([Buffer.from([IX.InitConfig]), encU16(feeBps)]),
      ),
    ),
    [payer, authority],
  );
  return configPda;
}

async function createAndApproveAsset(
  conn: InstanceType<typeof Connection>,
  programId: InstanceType<typeof PublicKey>,
  payer: InstanceType<typeof Keypair>,
  seller: InstanceType<typeof Keypair>,
  tokenId: Buffer,
  custodyPda: InstanceType<typeof PublicKey>,
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
  return asset;
}

export async function runLiveFixedPrice(opts?: { rpc?: string }): Promise<{
  nativeBuy: {
    phase: number;
    buyerOwns: string;
    platformDelta: bigint;
    sellerDelta: bigint;
    agentDelta: bigint;
    price: bigint;
    feeBps: number;
  };
  fiatRefuseCode: number;
  fiatNoFeedCode: number;
  staleBuyCode: number;
  wideConfCode: number;
  badOracleCode: number;
  fiatFresh: {
    phase: number;
    buyerOwns: boolean;
    expectedAssetAmt: number;
  };
  /** D-27: agented Margin fiat buy rewrites floor to asset units before split. */
  fiatAgented: {
    floorBefore: bigint;
    floorAfter: bigint;
    expectedFloorAsset: bigint;
    ownerDelta: bigint;
    agentDelta: bigint;
    platformDelta: bigint;
    amount: bigint;
  };
  external: {
    phase: number;
    buyerOwns: string;
    platformDelta: bigint;
    sellerDelta: bigint;
    escrowDelta: bigint;
  };
  pauseOpenCode: number;
  pauseBuyCode: number;
  pauseExternalPhase: number;
  softRevokeBuyPhase: number;
  /** SPL buy: platform+seller ATA amounts after settle (= price; delivery held through pull). */
  splBuySettledTotal: bigint;
  admittedDecimals: number;
  chainMintDecimals: number;
  transferFeeRefuseCode: number;
}> {
  const conn = new Connection(opts?.rpc ?? RPC, "confirmed");
  const programId = loadProgramId();
  const payer = Keypair.generate();
  const authority = Keypair.generate();
  const guardian = Keypair.generate();
  const platform = Keypair.generate();
  const seller = Keypair.generate();
  const agent = Keypair.generate();
  const buyer = Keypair.generate();
  await airdrop(conn, payer);
  for (const k of [authority, guardian, platform, seller, agent, buyer]) {
    await airdrop(conn, k, 8);
  }

  const feeBps = 250;
  const configPda = await initMode(conn, programId, payer, authority, platform, guardian, feeBps);
  const [custodyPda] = pda(programId, [Buffer.from("custody")]);

  // ---- Native buy ----
  const tokenN = Buffer.alloc(32, 0x11);
  const assetN = await createAndApproveAsset(conn, programId, payer, seller, tokenN, custodyPda);
  const [consignN] = pda(programId, [Buffer.from("consignment"), tokenN]);
  const [recallN] = pda(programId, [Buffer.from("recall"), tokenN]);
  const [escrowN] = pda(programId, [Buffer.from("escrow"), tokenN]);
  const priceN = 1000n;

  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: seller.publicKey, isSigner: true, isWritable: false },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: assetN, isSigner: false, isWritable: true },
          { pubkey: consignN, isSigner: false, isWritable: true },
          { pubkey: custodyPda, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        ],
        Buffer.concat([
          Buffer.from([IX.OpenDirect]),
          tokenN,
          Buffer.alloc(32, 0), // native mint
          Buffer.from([0]), // Asset denom
          Buffer.alloc(32, 0),
          encU64(priceN),
        ]),
      ),
    ),
    [seller, payer],
  );

  const lotN = readConsignment((await conn.getAccountInfo(consignN))!.data as Buffer);
  assert.equal(lotN.phase, PHASE.Offered);
  const platformAmt = (priceN * BigInt(lotN.feeBps)) / 10_000n;
  const sellerAmt = priceN - platformAmt; // direct: no agent
  const agentAmt = 0n;

  const balP0 = BigInt(await conn.getBalance(platform.publicKey));
  const balS0 = BigInt(await conn.getBalance(seller.publicKey));
  const balA0 = BigInt(await conn.getBalance(agent.publicKey));

  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: buyer.publicKey, isSigner: true, isWritable: true },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: consignN, isSigner: false, isWritable: true },
          { pubkey: assetN, isSigner: false, isWritable: true },
          { pubkey: platform.publicKey, isSigner: false, isWritable: true },
          { pubkey: seller.publicKey, isSigner: false, isWritable: true },
          { pubkey: agent.publicKey, isSigner: false, isWritable: true },
          { pubkey: recallN, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: escrowN, isSigner: false, isWritable: true },
        ],
        Buffer.concat([Buffer.from([IX.Buy]), tokenN]),
      ),
    ),
    [buyer, payer],
  );

  const closedN = readConsignment((await conn.getAccountInfo(consignN))!.data as Buffer);
  const assetAfterN = readAsset((await conn.getAccountInfo(assetN))!.data as Buffer);
  const buyerOwnsN = assetAfterN.owner.toBase58();
  assert.equal(closedN.phase, PHASE.Closed);
  assert.equal(buyerOwnsN, buyer.publicKey.toBase58());
  const balP1 = BigInt(await conn.getBalance(platform.publicKey));
  const balS1 = BigInt(await conn.getBalance(seller.publicKey));
  const balA1 = BigInt(await conn.getBalance(agent.publicKey));
  assert.equal(balP1 - balP0, platformAmt);
  assert.equal(balS1 - balS0, sellerAmt);
  assert.equal(balA1 - balA0, agentAmt);

  // ---- Fiat native refuse (no native USD feed on config) ----
  const tokenF = Buffer.alloc(32, 0x22);
  const assetF = await createAndApproveAsset(conn, programId, payer, seller, tokenF, custodyPda);
  const [consignF] = pda(programId, [Buffer.from("consignment"), tokenF]);
  const fiatRefuseCode = await expectCustom(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: seller.publicKey, isSigner: true, isWritable: false },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: assetF, isSigner: false, isWritable: true },
          { pubkey: consignF, isSigner: false, isWritable: true },
          { pubkey: custodyPda, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        ],
        Buffer.concat([
          Buffer.from([IX.OpenDirect]),
          tokenF,
          Buffer.alloc(32, 0),
          Buffer.from([1]), // Fiat
          CURRENCY_USD,
          encU64(500),
        ]),
      ),
    ),
    [seller, payer],
    ERR.CurrencyNotAvailableOnChain,
  );

  // ---- External confirm (no money movement) ----
  const tokenE = Buffer.alloc(32, 0x33);
  const assetE = await createAndApproveAsset(conn, programId, payer, seller, tokenE, custodyPda);
  const [consignE] = pda(programId, [Buffer.from("consignment"), tokenE]);
  const [recallE] = pda(programId, [Buffer.from("recall"), tokenE]);
  const [noteE] = pda(programId, [Buffer.from("settlement-note"), tokenE]);
  const [escrowE] = pda(programId, [Buffer.from("escrow"), tokenE]);

  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: seller.publicKey, isSigner: true, isWritable: false },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: assetE, isSigner: false, isWritable: true },
          { pubkey: consignE, isSigner: false, isWritable: true },
          { pubkey: custodyPda, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        ],
        Buffer.concat([
          Buffer.from([IX.OpenDirect]),
          tokenE,
          Buffer.alloc(32, 0),
          Buffer.from([0]),
          Buffer.alloc(32, 0),
          encU64(777),
        ]),
      ),
    ),
    [seller, payer],
  );

  const noteBytes = Buffer.alloc(256);
  Buffer.from("paid offline").copy(noteBytes);
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: seller.publicKey, isSigner: true, isWritable: false },
          { pubkey: consignE, isSigner: false, isWritable: false },
          { pubkey: noteE, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        ],
        Buffer.concat([
          Buffer.from([IX.SetSettlementNote]),
          tokenE,
          noteBytes,
          encU32(12),
        ]),
      ),
    ),
    [seller, payer],
  );

  const extP0 = BigInt(await conn.getBalance(platform.publicKey));
  const extS0 = BigInt(await conn.getBalance(seller.publicKey));
  const extEsc0 = BigInt((await conn.getAccountInfo(escrowE))?.lamports ?? 0);

  {
    const tx = new Transaction().add(
      ix(
        programId,
        [
          { pubkey: seller.publicKey, isSigner: true, isWritable: false },
          { pubkey: consignE, isSigner: false, isWritable: true },
          { pubkey: assetE, isSigner: false, isWritable: true },
          { pubkey: noteE, isSigner: false, isWritable: true },
          { pubkey: recallE, isSigner: false, isWritable: true },
        ],
        Buffer.concat([
          Buffer.from([IX.ConfirmExternalPayment]),
          tokenE,
          buyer.publicKey.toBuffer(),
        ]),
      ),
    );
    tx.feePayer = payer.publicKey;
    await sendAndConfirmTransaction(conn, tx, [payer, seller]);
  }

  const closedE = readConsignment((await conn.getAccountInfo(consignE))!.data as Buffer);
  const assetAfterE = readAsset((await conn.getAccountInfo(assetE))!.data as Buffer);
  const extBuyerOwns = assetAfterE.owner.toBase58();
  assert.equal(closedE.phase, PHASE.Closed);
  assert.equal(extBuyerOwns, buyer.publicKey.toBase58());
  const extP1 = BigInt(await conn.getBalance(platform.publicKey));
  const extS1 = BigInt(await conn.getBalance(seller.publicKey));
  const extEsc1 = BigInt((await conn.getAccountInfo(escrowE))?.lamports ?? 0);
  assert.equal(extP1 - extP0, 0n);
  assert.equal(extS1 - extS0, 0n);
  assert.equal(extEsc1 - extEsc0, 0n);

  // ---- Pause: open + buy refuse; external still works ----
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

  const tokenP = Buffer.alloc(32, 0x44);
  const assetP = await createAndApproveAsset(conn, programId, payer, seller, tokenP, custodyPda);
  const [consignP] = pda(programId, [Buffer.from("consignment"), tokenP]);
  const pauseOpenCode = await expectCustom(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: seller.publicKey, isSigner: true, isWritable: false },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: assetP, isSigner: false, isWritable: true },
          { pubkey: consignP, isSigner: false, isWritable: true },
          { pubkey: custodyPda, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        ],
        Buffer.concat([
          Buffer.from([IX.OpenDirect]),
          tokenP,
          Buffer.alloc(32, 0),
          Buffer.from([0]),
          Buffer.alloc(32, 0),
          encU64(100),
        ]),
      ),
    ),
    [seller, payer],
    ERR.ContractPaused,
  );

  // Unpause, open a lot, re-pause, buy refuses; external ok
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

  const tokenPb = Buffer.alloc(32, 0x45);
  const assetPb = await createAndApproveAsset(conn, programId, payer, seller, tokenPb, custodyPda);
  const [consignPb] = pda(programId, [Buffer.from("consignment"), tokenPb]);
  const [recallPb] = pda(programId, [Buffer.from("recall"), tokenPb]);
  const [escrowPb] = pda(programId, [Buffer.from("escrow"), tokenPb]);
  const [notePb] = pda(programId, [Buffer.from("settlement-note"), tokenPb]);

  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: seller.publicKey, isSigner: true, isWritable: false },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: assetPb, isSigner: false, isWritable: true },
          { pubkey: consignPb, isSigner: false, isWritable: true },
          { pubkey: custodyPda, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        ],
        Buffer.concat([
          Buffer.from([IX.OpenDirect]),
          tokenPb,
          Buffer.alloc(32, 0),
          Buffer.from([0]),
          Buffer.alloc(32, 0),
          encU64(200),
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
          { pubkey: guardian.publicKey, isSigner: true, isWritable: false },
          { pubkey: configPda, isSigner: false, isWritable: true },
        ],
        Buffer.from([IX.Pause]),
      ),
    ),
    [guardian],
  );

  const pauseBuyCode = await expectCustom(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: buyer.publicKey, isSigner: true, isWritable: true },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: consignPb, isSigner: false, isWritable: true },
          { pubkey: assetPb, isSigner: false, isWritable: true },
          { pubkey: platform.publicKey, isSigner: false, isWritable: true },
          { pubkey: seller.publicKey, isSigner: false, isWritable: true },
          { pubkey: agent.publicKey, isSigner: false, isWritable: true },
          { pubkey: recallPb, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: escrowPb, isSigner: false, isWritable: true },
        ],
        Buffer.concat([Buffer.from([IX.Buy]), tokenPb]),
      ),
    ),
    [buyer, payer],
    ERR.ContractPaused,
  );

  const notePbBytes = Buffer.alloc(256);
  Buffer.from("ext while paused").copy(notePbBytes);
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: seller.publicKey, isSigner: true, isWritable: false },
          { pubkey: consignPb, isSigner: false, isWritable: false },
          { pubkey: notePb, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        ],
        Buffer.concat([
          Buffer.from([IX.SetSettlementNote]),
          tokenPb,
          notePbBytes,
          encU32(15),
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
          { pubkey: seller.publicKey, isSigner: true, isWritable: false },
          { pubkey: consignPb, isSigner: false, isWritable: true },
          { pubkey: assetPb, isSigner: false, isWritable: true },
          { pubkey: notePb, isSigner: false, isWritable: true },
          { pubkey: recallPb, isSigner: false, isWritable: true },
        ],
        Buffer.concat([
          Buffer.from([IX.ConfirmExternalPayment]),
          tokenPb,
          buyer.publicKey.toBuffer(),
        ]),
      ),
    ),
    [seller],
  );
  const pauseExternalPhase = readConsignment((await conn.getAccountInfo(consignPb))!.data as Buffer)
    .phase;
  assert.equal(pauseExternalPhase, PHASE.Closed);

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

  // ---- SPL: admit, open, soft-revoke, buy still settles ----
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
        encApproveAssetOnly(),
      ),
    ),
    [authority, payer],
  );

  const payTokInfo = await conn.getAccountInfo(payTok);
  assert.ok(payTokInfo);
  const admittedDecimals = payTokInfo.data[8 + 32 + 1]!; // disc + mint + enabled
  const mintInfo = await conn.getAccountInfo(mint.publicKey);
  assert.ok(mintInfo);
  const chainMintDecimals = mintInfo.data[44]!;
  assert.equal(admittedDecimals, chainMintDecimals);
  assert.equal(admittedDecimals, 6);

  const tokenS = Buffer.alloc(32, 0x55);
  const assetS = await createAndApproveAsset(conn, programId, payer, seller, tokenS, custodyPda);
  const [consignS] = pda(programId, [Buffer.from("consignment"), tokenS]);
  const [recallS] = pda(programId, [Buffer.from("recall"), tokenS]);
  const [escrowS] = pda(programId, [Buffer.from("escrow"), tokenS]);
  const priceS = 1000n;

  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: seller.publicKey, isSigner: true, isWritable: false },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: assetS, isSigner: false, isWritable: true },
          { pubkey: consignS, isSigner: false, isWritable: true },
          { pubkey: custodyPda, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: payTok, isSigner: false, isWritable: false },
        ],
        Buffer.concat([
          Buffer.from([IX.OpenDirect]),
          tokenS,
          mint.publicKey.toBuffer(),
          Buffer.from([0]),
          Buffer.alloc(32, 0),
          encU64(priceS),
        ]),
      ),
    ),
    [seller, payer],
  );

  // Soft-revoke
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: guardian.publicKey, isSigner: true, isWritable: false },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: payTok, isSigner: false, isWritable: true },
        ],
        Buffer.concat([Buffer.from([IX.RevokePaymentToken]), mint.publicKey.toBuffer()]),
      ),
    ),
    [guardian],
  );

  // Buyer + escrow ATAs
  const buyerAta = Keypair.generate();
  const escrowAta = Keypair.generate();
  const ataRent = await getMinimumBalanceForRentExemptAccount(conn);
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: buyerAta.publicKey,
        space: 165,
        lamports: ataRent,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeAccount3Instruction(buyerAta.publicKey, mint.publicKey, buyer.publicKey),
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: escrowAta.publicKey,
        space: 165,
        lamports: ataRent,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeAccount3Instruction(escrowAta.publicKey, mint.publicKey, escrowS),
      createMintToInstruction(mint.publicKey, buyerAta.publicKey, payer.publicKey, Number(priceS)),
    ),
    [payer, buyerAta, escrowAta],
  );

  // Recipient ATAs for platform + seller (agent amount 0 on direct)
  const platformAta = Keypair.generate();
  const sellerAta = Keypair.generate();
  const [platClaim] = pda(programId, [
    Buffer.from("claim"),
    platform.publicKey.toBuffer(),
    mint.publicKey.toBuffer(),
  ]);
  const [platClaimAta] = pda(programId, [
    Buffer.from("claim-ata"),
    platform.publicKey.toBuffer(),
    mint.publicKey.toBuffer(),
  ]);
  const [sellClaim] = pda(programId, [
    Buffer.from("claim"),
    seller.publicKey.toBuffer(),
    mint.publicKey.toBuffer(),
  ]);
  const [sellClaimAta] = pda(programId, [
    Buffer.from("claim-ata"),
    seller.publicKey.toBuffer(),
    mint.publicKey.toBuffer(),
  ]);

  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: platformAta.publicKey,
        space: 165,
        lamports: ataRent,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeAccount3Instruction(platformAta.publicKey, mint.publicKey, platform.publicKey),
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: sellerAta.publicKey,
        space: 165,
        lamports: ataRent,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeAccount3Instruction(sellerAta.publicKey, mint.publicKey, seller.publicKey),
    ),
    [payer, platformAta, sellerAta],
  );

  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: buyer.publicKey, isSigner: true, isWritable: true },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: consignS, isSigner: false, isWritable: true },
          { pubkey: assetS, isSigner: false, isWritable: true },
          { pubkey: platform.publicKey, isSigner: false, isWritable: true },
          { pubkey: seller.publicKey, isSigner: false, isWritable: true },
          { pubkey: agent.publicKey, isSigner: false, isWritable: true },
          { pubkey: recallS, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: escrowS, isSigner: false, isWritable: true },
          { pubkey: buyerAta.publicKey, isSigner: false, isWritable: true },
          { pubkey: escrowAta.publicKey, isSigner: false, isWritable: true },
          { pubkey: mint.publicKey, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: platformAta.publicKey, isSigner: false, isWritable: true },
          { pubkey: platClaim, isSigner: false, isWritable: true },
          { pubkey: platClaimAta, isSigner: false, isWritable: true },
          { pubkey: sellerAta.publicKey, isSigner: false, isWritable: true },
          { pubkey: sellClaim, isSigner: false, isWritable: true },
          { pubkey: sellClaimAta, isSigner: false, isWritable: true },
        ],
        Buffer.concat([Buffer.from([IX.Buy]), tokenS]),
      ),
    ),
    [buyer, payer],
  );

  const softRevokeBuyPhase = readConsignment((await conn.getAccountInfo(consignS))!.data as Buffer)
    .phase;
  assert.equal(softRevokeBuyPhase, PHASE.Closed);
  const platTok = await getAccount(conn, platformAta.publicKey);
  const sellTok = await getAccount(conn, sellerAta.publicKey);
  const splBuySettledTotal = platTok.amount + sellTok.amount;
  assert.equal(splBuySettledTotal, priceS, "SPL pull+split must conserve full price (delivery)");

  // ---- Transfer-fee mint refused at admission (not at buy) ----
  const extensions = [ExtensionType.TransferFeeConfig];
  const mintLen = getMintLen(extensions);
  const feeMint = Keypair.generate();
  const feeMintRent = await conn.getMinimumBalanceForRentExemption(mintLen);
  const transferFeeBasisPoints = 100;
  const maxFee = BigInt(1e12);
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: feeMint.publicKey,
        space: mintLen,
        lamports: feeMintRent,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeTransferFeeConfigInstruction(
        feeMint.publicKey,
        payer.publicKey,
        payer.publicKey,
        transferFeeBasisPoints,
        maxFee,
        TOKEN_2022_PROGRAM_ID,
      ),
      createInitializeMint2Instruction(
        feeMint.publicKey,
        6,
        payer.publicKey,
        null,
        TOKEN_2022_PROGRAM_ID,
      ),
    ),
    [payer, feeMint],
  );

  const [payTokFee] = pda(programId, [
    Buffer.from("payment-token"),
    feeMint.publicKey.toBuffer(),
  ]);
  const transferFeeRefuseCode = await expectCustom(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: authority.publicKey, isSigner: true, isWritable: false },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: feeMint.publicKey, isSigner: false, isWritable: false },
          { pubkey: payTokFee, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        ],
        encApproveAssetOnly(),
      ),
    ),
    [authority, payer],
    ERR.TransferFeeExtensionForbidden,
  );

  // ---- Fiat SPL: no feed → PaymentTokenFeedRequired (fresh enabled asset-only mint) ----
  const mintNoFeed = Keypair.generate();
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mintNoFeed.publicKey,
        space: 82,
        lamports: await getMinimumBalanceForRentExemptMint(conn),
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(mintNoFeed.publicKey, 6, payer.publicKey, null),
    ),
    [payer, mintNoFeed],
  );
  const [payTokNoFeed] = pda(programId, [
    Buffer.from("payment-token"),
    mintNoFeed.publicKey.toBuffer(),
  ]);
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: authority.publicKey, isSigner: true, isWritable: false },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: mintNoFeed.publicKey, isSigner: false, isWritable: false },
          { pubkey: payTokNoFeed, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        ],
        encApproveAssetOnly(),
      ),
    ),
    [authority, payer],
  );
  const tokenNoFeed = Buffer.alloc(32, 0x66);
  const assetNoFeed = await createAndApproveAsset(
    conn,
    programId,
    payer,
    seller,
    tokenNoFeed,
    custodyPda,
  );
  const [consignNoFeed] = pda(programId, [Buffer.from("consignment"), tokenNoFeed]);
  const fiatNoFeedCode = await expectCustom(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: seller.publicKey, isSigner: true, isWritable: false },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: assetNoFeed, isSigner: false, isWritable: true },
          { pubkey: consignNoFeed, isSigner: false, isWritable: true },
          { pubkey: custodyPda, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: payTokNoFeed, isSigner: false, isWritable: false },
        ],
        Buffer.concat([
          Buffer.from([IX.OpenDirect]),
          tokenNoFeed,
          mintNoFeed.publicKey.toBuffer(),
          Buffer.from([1]),
          CURRENCY_USD,
          encU64(100_000_000n),
        ]),
      ),
    ),
    [seller, payer],
    ERR.PaymentTokenFeedRequired,
  );

  // ---- Fiat SPL with lab price account ----
  const mintFiat = Keypair.generate();
  const mintFiatLamports = await getMinimumBalanceForRentExemptMint(conn);
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mintFiat.publicKey,
        space: 82,
        lamports: mintFiatLamports,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(mintFiat.publicKey, 6, payer.publicKey, null),
    ),
    [payer, mintFiat],
  );
  const [payTokFiat] = pda(programId, [
    Buffer.from("payment-token"),
    mintFiat.publicKey.toBuffer(),
  ]);
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: authority.publicKey, isSigner: true, isWritable: false },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: mintFiat.publicKey, isSigner: false, isWritable: false },
          { pubkey: payTokFiat, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        ],
        encApproveWithFeed(programId, LAB_FEED_ID, 3600, 200),
      ),
    ),
    [authority, payer],
  );

  const [priceLabPda] = pda(programId, [Buffer.from("price-lab"), LAB_FEED_ID]);
  const slot = await conn.getSlot("confirmed");
  let nowUnix = await conn.getBlockTime(slot);
  if (nowUnix == null) nowUnix = Math.floor(Date.now() / 1000);

  async function seedPrice(fixtureName: string, publishUnix: number) {
    const raw = readFileSync(path.join(FIXTURES, fixtureName));
    const data = patchPublishTime(raw, publishUnix);
    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        ix(
          programId,
          [
            { pubkey: authority.publicKey, isSigner: true, isWritable: false },
            { pubkey: configPda, isSigner: false, isWritable: false },
            { pubkey: priceLabPda, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          ],
          Buffer.concat([
            Buffer.from([IX.ForceSeedPriceAccount]),
            LAB_FEED_ID,
            data,
          ]),
        ),
      ),
      [authority, payer],
    );
  }

  // Stale → StalePrice
  await seedPrice("lab-stale.bin", nowUnix - 1_000_000);
  const tokenStale = Buffer.alloc(32, 0x71);
  const assetStale = await createAndApproveAsset(
    conn,
    programId,
    payer,
    seller,
    tokenStale,
    custodyPda,
  );
  const [consignStale] = pda(programId, [Buffer.from("consignment"), tokenStale]);
  const [recallStale] = pda(programId, [Buffer.from("recall"), tokenStale]);
  const [escrowStale] = pda(programId, [Buffer.from("escrow"), tokenStale]);
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: seller.publicKey, isSigner: true, isWritable: false },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: assetStale, isSigner: false, isWritable: true },
          { pubkey: consignStale, isSigner: false, isWritable: true },
          { pubkey: custodyPda, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: payTokFiat, isSigner: false, isWritable: false },
        ],
        Buffer.concat([
          Buffer.from([IX.OpenDirect]),
          tokenStale,
          mintFiat.publicKey.toBuffer(),
          Buffer.from([1]),
          CURRENCY_USD,
          encU64(150_0000_0000n),
        ]),
      ),
    ),
    [seller, payer],
  );
  const buyerAtaStale = Keypair.generate();
  const escrowAtaStale = Keypair.generate();
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: buyerAtaStale.publicKey,
        space: 165,
        lamports: ataRent,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeAccount3Instruction(
        buyerAtaStale.publicKey,
        mintFiat.publicKey,
        buyer.publicKey,
      ),
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: escrowAtaStale.publicKey,
        space: 165,
        lamports: ataRent,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeAccount3Instruction(escrowAtaStale.publicKey, mintFiat.publicKey, escrowStale),
      createMintToInstruction(mintFiat.publicKey, buyerAtaStale.publicKey, payer.publicKey, 2_000_000),
    ),
    [payer, buyerAtaStale, escrowAtaStale],
  );
  const staleBuyCode = await expectCustom(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: buyer.publicKey, isSigner: true, isWritable: true },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: consignStale, isSigner: false, isWritable: true },
          { pubkey: assetStale, isSigner: false, isWritable: true },
          { pubkey: platform.publicKey, isSigner: false, isWritable: true },
          { pubkey: seller.publicKey, isSigner: false, isWritable: true },
          { pubkey: seller.publicKey, isSigner: false, isWritable: true },
          { pubkey: recallStale, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: escrowStale, isSigner: false, isWritable: true },
          { pubkey: payTokFiat, isSigner: false, isWritable: false },
          { pubkey: priceLabPda, isSigner: false, isWritable: false },
          { pubkey: buyerAtaStale.publicKey, isSigner: false, isWritable: true },
          { pubkey: escrowAtaStale.publicKey, isSigner: false, isWritable: true },
          { pubkey: mintFiat.publicKey, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        Buffer.concat([Buffer.from([IX.Buy]), tokenStale]),
      ),
    ),
    [buyer, payer],
    ERR.StalePrice,
  );

  // Wide conf → ConfidenceTooWide
  await seedPrice("lab-wide_conf.bin", nowUnix);
  const tokenWide = Buffer.alloc(32, 0x72);
  const assetWide = await createAndApproveAsset(
    conn,
    programId,
    payer,
    seller,
    tokenWide,
    custodyPda,
  );
  const [consignWide] = pda(programId, [Buffer.from("consignment"), tokenWide]);
  const [recallWide] = pda(programId, [Buffer.from("recall"), tokenWide]);
  const [escrowWide] = pda(programId, [Buffer.from("escrow"), tokenWide]);
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: seller.publicKey, isSigner: true, isWritable: false },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: assetWide, isSigner: false, isWritable: true },
          { pubkey: consignWide, isSigner: false, isWritable: true },
          { pubkey: custodyPda, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: payTokFiat, isSigner: false, isWritable: false },
        ],
        Buffer.concat([
          Buffer.from([IX.OpenDirect]),
          tokenWide,
          mintFiat.publicKey.toBuffer(),
          Buffer.from([1]),
          CURRENCY_USD,
          encU64(150_0000_0000n),
        ]),
      ),
    ),
    [seller, payer],
  );
  const buyerAtaWide = Keypair.generate();
  const escrowAtaWide = Keypair.generate();
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: buyerAtaWide.publicKey,
        space: 165,
        lamports: ataRent,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeAccount3Instruction(
        buyerAtaWide.publicKey,
        mintFiat.publicKey,
        buyer.publicKey,
      ),
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: escrowAtaWide.publicKey,
        space: 165,
        lamports: ataRent,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeAccount3Instruction(escrowAtaWide.publicKey, mintFiat.publicKey, escrowWide),
      createMintToInstruction(mintFiat.publicKey, buyerAtaWide.publicKey, payer.publicKey, 2_000_000),
    ),
    [payer, buyerAtaWide, escrowAtaWide],
  );
  const wideConfCode = await expectCustom(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: buyer.publicKey, isSigner: true, isWritable: true },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: consignWide, isSigner: false, isWritable: true },
          { pubkey: assetWide, isSigner: false, isWritable: true },
          { pubkey: platform.publicKey, isSigner: false, isWritable: true },
          { pubkey: seller.publicKey, isSigner: false, isWritable: true },
          { pubkey: seller.publicKey, isSigner: false, isWritable: true },
          { pubkey: recallWide, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: escrowWide, isSigner: false, isWritable: true },
          { pubkey: payTokFiat, isSigner: false, isWritable: false },
          { pubkey: priceLabPda, isSigner: false, isWritable: false },
          { pubkey: buyerAtaWide.publicKey, isSigner: false, isWritable: true },
          { pubkey: escrowAtaWide.publicKey, isSigner: false, isWritable: true },
          { pubkey: mintFiat.publicKey, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        Buffer.concat([Buffer.from([IX.Buy]), tokenWide]),
      ),
    ),
    [buyer, payer],
    ERR.ConfidenceTooWide,
  );

  // Non-positive → BadOracleAnswer
  await seedPrice("lab-non_positive.bin", nowUnix);
  const tokenBad = Buffer.alloc(32, 0x73);
  const assetBad = await createAndApproveAsset(conn, programId, payer, seller, tokenBad, custodyPda);
  const [consignBad] = pda(programId, [Buffer.from("consignment"), tokenBad]);
  const [recallBad] = pda(programId, [Buffer.from("recall"), tokenBad]);
  const [escrowBad] = pda(programId, [Buffer.from("escrow"), tokenBad]);
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: seller.publicKey, isSigner: true, isWritable: false },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: assetBad, isSigner: false, isWritable: true },
          { pubkey: consignBad, isSigner: false, isWritable: true },
          { pubkey: custodyPda, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: payTokFiat, isSigner: false, isWritable: false },
        ],
        Buffer.concat([
          Buffer.from([IX.OpenDirect]),
          tokenBad,
          mintFiat.publicKey.toBuffer(),
          Buffer.from([1]),
          CURRENCY_USD,
          encU64(150_0000_0000n),
        ]),
      ),
    ),
    [seller, payer],
  );
  const buyerAtaBad = Keypair.generate();
  const escrowAtaBad = Keypair.generate();
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: buyerAtaBad.publicKey,
        space: 165,
        lamports: ataRent,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeAccount3Instruction(buyerAtaBad.publicKey, mintFiat.publicKey, buyer.publicKey),
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: escrowAtaBad.publicKey,
        space: 165,
        lamports: ataRent,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeAccount3Instruction(escrowAtaBad.publicKey, mintFiat.publicKey, escrowBad),
      createMintToInstruction(mintFiat.publicKey, buyerAtaBad.publicKey, payer.publicKey, 2_000_000),
    ),
    [payer, buyerAtaBad, escrowAtaBad],
  );
  const badOracleCode = await expectCustom(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: buyer.publicKey, isSigner: true, isWritable: true },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: consignBad, isSigner: false, isWritable: true },
          { pubkey: assetBad, isSigner: false, isWritable: true },
          { pubkey: platform.publicKey, isSigner: false, isWritable: true },
          { pubkey: seller.publicKey, isSigner: false, isWritable: true },
          { pubkey: seller.publicKey, isSigner: false, isWritable: true },
          { pubkey: recallBad, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: escrowBad, isSigner: false, isWritable: true },
          { pubkey: payTokFiat, isSigner: false, isWritable: false },
          { pubkey: priceLabPda, isSigner: false, isWritable: false },
          { pubkey: buyerAtaBad.publicKey, isSigner: false, isWritable: true },
          { pubkey: escrowAtaBad.publicKey, isSigner: false, isWritable: true },
          { pubkey: mintFiat.publicKey, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        Buffer.concat([Buffer.from([IX.Buy]), tokenBad]),
      ),
    ),
    [buyer, payer],
    ERR.BadOracleAnswer,
  );

  // Fresh narrow → settle (fiat $150 → 1_000_000 token units at feed $150)
  await seedPrice("lab-fresh_narrow.bin", nowUnix);
  const tokenFresh = Buffer.alloc(32, 0x74);
  const assetFresh = await createAndApproveAsset(
    conn,
    programId,
    payer,
    seller,
    tokenFresh,
    custodyPda,
  );
  const [consignFresh] = pda(programId, [Buffer.from("consignment"), tokenFresh]);
  const [recallFresh] = pda(programId, [Buffer.from("recall"), tokenFresh]);
  const [escrowFresh] = pda(programId, [Buffer.from("escrow"), tokenFresh]);
  const fiatPrice1e8 = 150_0000_0000n;
  const expectedAssetAmt = 1_000_000n; // 150e8 * 1e6 / 150e8
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: seller.publicKey, isSigner: true, isWritable: false },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: assetFresh, isSigner: false, isWritable: true },
          { pubkey: consignFresh, isSigner: false, isWritable: true },
          { pubkey: custodyPda, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: payTokFiat, isSigner: false, isWritable: false },
        ],
        Buffer.concat([
          Buffer.from([IX.OpenDirect]),
          tokenFresh,
          mintFiat.publicKey.toBuffer(),
          Buffer.from([1]),
          CURRENCY_USD,
          encU64(fiatPrice1e8),
        ]),
      ),
    ),
    [seller, payer],
  );
  const buyerAtaFresh = Keypair.generate();
  const escrowAtaFresh = Keypair.generate();
  const platformAtaF = Keypair.generate();
  const sellerAtaF = Keypair.generate();
  const [platClaimF] = pda(programId, [
    Buffer.from("claim"),
    platform.publicKey.toBuffer(),
    mintFiat.publicKey.toBuffer(),
  ]);
  const [platClaimAtaF] = pda(programId, [
    Buffer.from("claim-ata"),
    platform.publicKey.toBuffer(),
    mintFiat.publicKey.toBuffer(),
  ]);
  const [sellClaimF] = pda(programId, [
    Buffer.from("claim"),
    seller.publicKey.toBuffer(),
    mintFiat.publicKey.toBuffer(),
  ]);
  const [sellClaimAtaF] = pda(programId, [
    Buffer.from("claim-ata"),
    seller.publicKey.toBuffer(),
    mintFiat.publicKey.toBuffer(),
  ]);
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: buyerAtaFresh.publicKey,
        space: 165,
        lamports: ataRent,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeAccount3Instruction(
        buyerAtaFresh.publicKey,
        mintFiat.publicKey,
        buyer.publicKey,
      ),
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: escrowAtaFresh.publicKey,
        space: 165,
        lamports: ataRent,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeAccount3Instruction(escrowAtaFresh.publicKey, mintFiat.publicKey, escrowFresh),
      createMintToInstruction(
        mintFiat.publicKey,
        buyerAtaFresh.publicKey,
        payer.publicKey,
        Number(expectedAssetAmt),
      ),
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: platformAtaF.publicKey,
        space: 165,
        lamports: ataRent,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeAccount3Instruction(
        platformAtaF.publicKey,
        mintFiat.publicKey,
        platform.publicKey,
      ),
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: sellerAtaF.publicKey,
        space: 165,
        lamports: ataRent,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeAccount3Instruction(sellerAtaF.publicKey, mintFiat.publicKey, seller.publicKey),
    ),
    [payer, buyerAtaFresh, escrowAtaFresh, platformAtaF, sellerAtaF],
  );
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: buyer.publicKey, isSigner: true, isWritable: true },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: consignFresh, isSigner: false, isWritable: true },
          { pubkey: assetFresh, isSigner: false, isWritable: true },
          { pubkey: platform.publicKey, isSigner: false, isWritable: true },
          { pubkey: seller.publicKey, isSigner: false, isWritable: true },
          { pubkey: seller.publicKey, isSigner: false, isWritable: true },
          { pubkey: recallFresh, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: escrowFresh, isSigner: false, isWritable: true },
          { pubkey: payTokFiat, isSigner: false, isWritable: false },
          { pubkey: priceLabPda, isSigner: false, isWritable: false },
          { pubkey: buyerAtaFresh.publicKey, isSigner: false, isWritable: true },
          { pubkey: escrowAtaFresh.publicKey, isSigner: false, isWritable: true },
          { pubkey: mintFiat.publicKey, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: platformAtaF.publicKey, isSigner: false, isWritable: true },
          { pubkey: platClaimF, isSigner: false, isWritable: true },
          { pubkey: platClaimAtaF, isSigner: false, isWritable: true },
          { pubkey: sellerAtaF.publicKey, isSigner: false, isWritable: true },
          { pubkey: sellClaimF, isSigner: false, isWritable: true },
          { pubkey: sellClaimAtaF, isSigner: false, isWritable: true },
        ],
        Buffer.concat([Buffer.from([IX.Buy]), tokenFresh]),
      ),
    ),
    [buyer, payer],
  );
  const freshClosed = readConsignment((await conn.getAccountInfo(consignFresh))!.data);
  const freshAsset = readAsset((await conn.getAccountInfo(assetFresh))!.data);
  assert.equal(freshClosed.phase, PHASE.Closed);
  assert.equal(freshAsset.owner.toBase58(), buyer.publicKey.toBase58());
  const escrowFreshAcc = await getAccount(conn, escrowAtaFresh.publicKey);
  assert.equal(escrowFreshAcc.amount, 0n);

  // ---- Agented Margin fiat: Grant → OpenFromMandate → ForceSeed → Buy (D-27 floor rewrite) ----
  await seedPrice("lab-fresh_narrow.bin", nowUnix);
  const tokenAg = Buffer.alloc(32, 0x75);
  const assetAg = await createAndApproveAsset(conn, programId, payer, seller, tokenAg, custodyPda);
  const [mandateAg] = pda(programId, [Buffer.from("mandate"), tokenAg]);
  const [consignAg] = pda(programId, [Buffer.from("consignment"), tokenAg]);
  const [recallAg] = pda(programId, [Buffer.from("recall"), tokenAg]);
  const [escrowAg] = pda(programId, [Buffer.from("escrow"), tokenAg]);
  const fiatFloor1e8 = 100_0000_0000n; // $100 floor (fiat 1e8)
  const fiatAgentedPrice = fiatPrice1e8; // $150 ≥ floor
  const feeBpsAg = 250n;
  const amountAg = expectedAssetAmt; // same feed → 1_000_000
  // Margin scale base = settled − ⌊settled·fee/10000⌋
  const baseFiat =
    fiatAgentedPrice - (fiatAgentedPrice * feeBpsAg) / 10_000n;
  const baseAsset = amountAg - (amountAg * feeBpsAg) / 10_000n;
  const expectedFloorAsset = (baseAsset * fiatFloor1e8) / baseFiat;

  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: seller.publicKey, isSigner: true, isWritable: false },
          { pubkey: assetAg, isSigner: false, isWritable: false },
          { pubkey: mandateAg, isSigner: false, isWritable: true },
          { pubkey: consignAg, isSigner: false, isWritable: false },
          { pubkey: custodyPda, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        ],
        Buffer.concat([
          Buffer.from([IX.Grant]),
          tokenAg,
          agent.publicKey.toBuffer(),
          encU64(0), // no expiry
          mintFiat.publicKey.toBuffer(),
          Buffer.from([DENOM_FIAT]),
          CURRENCY_USD,
          encU64(fiatFloor1e8),
          Buffer.from([FORM_MARGIN]),
          encU16(0), // commission 0
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
          { pubkey: assetAg, isSigner: false, isWritable: true },
          { pubkey: mandateAg, isSigner: false, isWritable: false },
          { pubkey: consignAg, isSigner: false, isWritable: true },
          { pubkey: custodyPda, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: payTokFiat, isSigner: false, isWritable: false },
        ],
        Buffer.concat([
          Buffer.from([IX.OpenFromMandate]),
          tokenAg,
          Buffer.from([DENOM_FIAT]),
          CURRENCY_USD,
          encU64(fiatAgentedPrice),
        ]),
      ),
    ),
    [agent, payer],
  );

  const lotAgBefore = readConsignment((await conn.getAccountInfo(consignAg))!.data as Buffer);
  assert.equal(lotAgBefore.phase, PHASE.Offered);
  assert.equal(lotAgBefore.floor, fiatFloor1e8);
  assert.equal(lotAgBefore.feeBps, 250);
  const floorBefore = lotAgBefore.floor;

  const buyerAtaAg = Keypair.generate();
  const escrowAtaAg = Keypair.generate();
  const platformAtaAg = Keypair.generate();
  const sellerAtaAg = Keypair.generate();
  const agentAtaAg = Keypair.generate();
  const [platClaimAg] = pda(programId, [
    Buffer.from("claim"),
    platform.publicKey.toBuffer(),
    mintFiat.publicKey.toBuffer(),
  ]);
  const [platClaimAtaAg] = pda(programId, [
    Buffer.from("claim-ata"),
    platform.publicKey.toBuffer(),
    mintFiat.publicKey.toBuffer(),
  ]);
  const [sellClaimAg] = pda(programId, [
    Buffer.from("claim"),
    seller.publicKey.toBuffer(),
    mintFiat.publicKey.toBuffer(),
  ]);
  const [sellClaimAtaAg] = pda(programId, [
    Buffer.from("claim-ata"),
    seller.publicKey.toBuffer(),
    mintFiat.publicKey.toBuffer(),
  ]);
  const [agentClaimAg] = pda(programId, [
    Buffer.from("claim"),
    agent.publicKey.toBuffer(),
    mintFiat.publicKey.toBuffer(),
  ]);
  const [agentClaimAtaAg] = pda(programId, [
    Buffer.from("claim-ata"),
    agent.publicKey.toBuffer(),
    mintFiat.publicKey.toBuffer(),
  ]);

  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: buyerAtaAg.publicKey,
        space: 165,
        lamports: ataRent,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeAccount3Instruction(
        buyerAtaAg.publicKey,
        mintFiat.publicKey,
        buyer.publicKey,
      ),
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: escrowAtaAg.publicKey,
        space: 165,
        lamports: ataRent,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeAccount3Instruction(escrowAtaAg.publicKey, mintFiat.publicKey, escrowAg),
      createMintToInstruction(
        mintFiat.publicKey,
        buyerAtaAg.publicKey,
        payer.publicKey,
        Number(amountAg),
      ),
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: platformAtaAg.publicKey,
        space: 165,
        lamports: ataRent,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeAccount3Instruction(
        platformAtaAg.publicKey,
        mintFiat.publicKey,
        platform.publicKey,
      ),
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: sellerAtaAg.publicKey,
        space: 165,
        lamports: ataRent,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeAccount3Instruction(
        sellerAtaAg.publicKey,
        mintFiat.publicKey,
        seller.publicKey,
      ),
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: agentAtaAg.publicKey,
        space: 165,
        lamports: ataRent,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeAccount3Instruction(agentAtaAg.publicKey, mintFiat.publicKey, agent.publicKey),
    ),
    [payer, buyerAtaAg, escrowAtaAg, platformAtaAg, sellerAtaAg, agentAtaAg],
  );

  const platBal0 = (await getAccount(conn, platformAtaAg.publicKey)).amount;
  const sellBal0 = (await getAccount(conn, sellerAtaAg.publicKey)).amount;
  const agentBal0 = (await getAccount(conn, agentAtaAg.publicKey)).amount;

  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: buyer.publicKey, isSigner: true, isWritable: true },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: consignAg, isSigner: false, isWritable: true },
          { pubkey: assetAg, isSigner: false, isWritable: true },
          { pubkey: platform.publicKey, isSigner: false, isWritable: true },
          { pubkey: seller.publicKey, isSigner: false, isWritable: true },
          { pubkey: agent.publicKey, isSigner: false, isWritable: true },
          { pubkey: recallAg, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: escrowAg, isSigner: false, isWritable: true },
          { pubkey: payTokFiat, isSigner: false, isWritable: false },
          { pubkey: priceLabPda, isSigner: false, isWritable: false },
          { pubkey: buyerAtaAg.publicKey, isSigner: false, isWritable: true },
          { pubkey: escrowAtaAg.publicKey, isSigner: false, isWritable: true },
          { pubkey: mintFiat.publicKey, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: platformAtaAg.publicKey, isSigner: false, isWritable: true },
          { pubkey: platClaimAg, isSigner: false, isWritable: true },
          { pubkey: platClaimAtaAg, isSigner: false, isWritable: true },
          { pubkey: sellerAtaAg.publicKey, isSigner: false, isWritable: true },
          { pubkey: sellClaimAg, isSigner: false, isWritable: true },
          { pubkey: sellClaimAtaAg, isSigner: false, isWritable: true },
          { pubkey: agentAtaAg.publicKey, isSigner: false, isWritable: true },
          { pubkey: agentClaimAg, isSigner: false, isWritable: true },
          { pubkey: agentClaimAtaAg, isSigner: false, isWritable: true },
        ],
        Buffer.concat([Buffer.from([IX.Buy]), tokenAg]),
      ),
    ),
    [buyer, payer],
  );

  const closedAg = readConsignment((await conn.getAccountInfo(consignAg))!.data as Buffer);
  const assetAfterAg = readAsset((await conn.getAccountInfo(assetAg))!.data as Buffer);
  assert.equal(closedAg.phase, PHASE.Closed);
  const buyerOwnsAg = assetAfterAg.owner.toBase58();
  assert.equal(buyerOwnsAg, buyer.publicKey.toBase58());
  // Sold clears durable floor; rewrite is proven by Margin owner leg === expectedFloorAsset.
  assert.equal(closedAg.floor, 0n);

  const platformDeltaAg =
    (await getAccount(conn, platformAtaAg.publicKey)).amount - platBal0;
  const ownerDeltaAg = (await getAccount(conn, sellerAtaAg.publicKey)).amount - sellBal0;
  const agentDeltaAg = (await getAccount(conn, agentAtaAg.publicKey)).amount - agentBal0;
  const expectedPlatformAg = (amountAg * feeBpsAg) / 10_000n;
  const expectedAgentAg = amountAg - expectedPlatformAg - expectedFloorAsset;
  assert.equal(ownerDeltaAg, expectedFloorAsset, "D-27 Margin owner = rewritten floor");
  assert.equal(platformDeltaAg, expectedPlatformAg);
  assert.equal(agentDeltaAg, expectedAgentAg);
  assert.equal(platformDeltaAg + ownerDeltaAg + agentDeltaAg, amountAg);
  const floorAfter = expectedFloorAsset; // rewritten floor applied at settle (proven via owner leg)

  return withStandArtifactBindings({
    nativeBuy: {
      phase: closedN.phase,
      buyerOwns: buyerOwnsN,
      platformDelta: balP1 - balP0,
      sellerDelta: balS1 - balS0,
      agentDelta: balA1 - balA0,
      price: priceN,
      feeBps: lotN.feeBps,
    },
    fiatRefuseCode,
    fiatNoFeedCode,
    staleBuyCode,
    wideConfCode,
    badOracleCode,
    fiatFresh: {
      phase: freshClosed.phase,
      buyerOwns: freshAsset.owner.toBase58() === buyer.publicKey.toBase58(),
      expectedAssetAmt: Number(expectedAssetAmt),
    },
    fiatAgented: {
      floorBefore,
      floorAfter,
      expectedFloorAsset,
      ownerDelta: ownerDeltaAg,
      agentDelta: agentDeltaAg,
      platformDelta: platformDeltaAg,
      amount: amountAg,
    },
    external: {
      phase: closedE.phase,
      buyerOwns: extBuyerOwns,
      platformDelta: extP1 - extP0,
      sellerDelta: extS1 - extS0,
      escrowDelta: extEsc1 - extEsc0,
    },
    pauseOpenCode,
    pauseBuyCode,
    pauseExternalPhase,
    softRevokeBuyPhase,
    splBuySettledTotal,
    admittedDecimals,
    chainMintDecimals,
    transferFeeRefuseCode,
  });
}
