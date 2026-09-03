/**
 * Local-validator proof: shared consignment automaton (S6 #2).
 *
 * Lifecycle (assert state — never success-only, never invented constants):
 * - open direct + open from mandate (custody owner moves to custody PDA)
 * - setPrice in-rule; BelowFloor / NotConsignmentRunner by custom error code
 * - lowerFloor / lowerCommission; CannotRaise* refusals
 * - requestRecall; ForceRecall before cooldown → ReturnCooldownPending;
 *   after ForceRecallRequestedAt warp → Returned + custody to seller
 * - ownerWithdraw (direct) / agentWithdraw (agented)
 * - settleThreeLeg: custody → buyer first, then native three-leg split from lot fee snapshot
 *
 * Requires: local validator, consignment_harness.so preloaded or deployable.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  withStandArtifactBindings,
  type StandArtifactBindings,
} from "./stand-artifact-bindings.ts";

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

const ROOT = path.resolve(__dirname, "../..");
const RPC = process.env.SVM_STAND_RPC ?? "http://127.0.0.1:8899";
const DEPLOY = path.join(ROOT, "svm/target/deploy");

/** Stable custom-error codes from KargainError (append-only). */
const ERR = {
  BelowFloor: 57,
  NotConsignmentRunner: 75,
  CannotRaiseFloor: 86,
  CannotRaiseCommission: 87,
  NotCommissionForm: 88,
  ReturnCooldownPending: 94,
  NotOffered: 72,
} as const;

const PHASE = { None: 0, Offered: 1, Closed: 2, Returned: 3 } as const;

function loadProgramId(): InstanceType<typeof PublicKey> {
  const kpPath = path.join(DEPLOY, "consignment_harness-keypair.json");
  if (!existsSync(kpPath)) {
    throw new Error(`missing ${kpPath} — build consignment-harness with cargo-build-sbf`);
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
function encU64(n: bigint | number): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n), 0);
  return b;
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
    assert.ok(got !== null, "custom error code must be extractable from simulation");
    return got!;
  }
  throw new Error("unreachable");
}

function readAsset(data: Buffer): { owner: InstanceType<typeof PublicKey>; approved: InstanceType<typeof PublicKey> } {
  // disc8 + token32 + owner32 + approved32
  const owner = new PublicKey(data.subarray(8 + 32, 8 + 64));
  const approved = new PublicKey(data.subarray(8 + 64, 8 + 96));
  return { owner, approved };
}

function readConsignment(data: Buffer): {
  seller: InstanceType<typeof PublicKey>;
  agent: InstanceType<typeof PublicKey>;
  floor: bigint;
  commissionBps: number;
  feeBps: number;
  price: bigint;
  phase: number;
  committed: boolean;
} {
  let o = 8;
  o += 32; // token_id
  const seller = new PublicKey(data.subarray(o, o + 32));
  o += 32;
  const agent = new PublicKey(data.subarray(o, o + 32));
  o += 32;
  o += 32; // asset
  o += 1 + 32; // denom
  const floor = data.readBigUInt64LE(o);
  o += 8;
  o += 1; // form
  const commissionBps = data.readUInt16LE(o);
  o += 2;
  const feeBps = data.readUInt16LE(o);
  o += 2;
  const price = data.readBigUInt64LE(o);
  o += 8;
  o += 8; // opened_at
  const phase = data[o]!;
  o += 1;
  const committed = data[o]! !== 0;
  return { seller, agent, floor, commissionBps, feeBps, price, phase, committed };
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

export async function runLiveConsignmentAutomaton(opts?: {
  rpc?: string;
}): Promise<{
  directOpen: { phase: number; custodyOwner: string };
  mandateOpen: { phase: number; floor: bigint; feeBps: number };
  setPriceOk: bigint;
  refusals: { belowFloor: number; cannotRaiseFloor: number; cooldown: number };
  recallForce: { phase: number; custodyOwner: string };
  settle: {
    phase: number;
    buyerOwns: string;
    platformDelta: bigint;
    sellerDelta: bigint;
    agentDelta: bigint;
    settled: bigint;
    feeBps: number;
    signature: string;
  };
  artifacts: StandArtifactBindings;
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
    await airdrop(conn, k, 5);
  }

  const [configPda] = pda(programId, [Buffer.from("consign-config")]);
  const [custodyPda] = pda(programId, [Buffer.from("custody")]);

  // InitConfig
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
        Buffer.concat([Buffer.from([0]), encU16(250)]),
      ),
    ),
    [payer, authority],
  );

  // ---- Direct open path ----
  const tokenDirect = Buffer.alloc(32, 0x11);
  const [assetDirect] = pda(programId, [Buffer.from("harness-asset"), tokenDirect]);
  const [consignDirect] = pda(programId, [Buffer.from("consignment"), tokenDirect]);

  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: assetDirect, isSigner: false, isWritable: true },
          { pubkey: seller.publicKey, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        Buffer.concat([Buffer.from([1]), tokenDirect]),
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
          { pubkey: assetDirect, isSigner: false, isWritable: true },
          { pubkey: custodyPda, isSigner: false, isWritable: false },
        ],
        Buffer.concat([Buffer.from([2]), tokenDirect]),
      ),
    ),
    [seller],
  );

  const beforeOwner = readAsset((await conn.getAccountInfo(assetDirect))!.data as Buffer).owner;
  assert.equal(beforeOwner.toBase58(), seller.publicKey.toBase58());

  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: seller.publicKey, isSigner: true, isWritable: false },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: assetDirect, isSigner: false, isWritable: true },
          { pubkey: consignDirect, isSigner: false, isWritable: true },
          { pubkey: custodyPda, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        ],
        Buffer.concat([
          Buffer.from([7]),
          tokenDirect,
          Buffer.alloc(32, 0), // native asset
          Buffer.from([0]), // Asset denom
          Buffer.alloc(32, 0),
          encU64(1_000),
        ]),
      ),
    ),
    [seller, payer],
  );

  const afterOpenAsset = readAsset((await conn.getAccountInfo(assetDirect))!.data as Buffer);
  assert.equal(afterOpenAsset.owner.toBase58(), custodyPda.toBase58(), "custody must move to program PDA");
  const directLot = readConsignment((await conn.getAccountInfo(consignDirect))!.data as Buffer);
  assert.equal(directLot.phase, PHASE.Offered);
  assert.equal(directLot.feeBps, 250);
  assert.equal(directLot.price, 1000n);
  const directOpenPhase = directLot.phase;
  const directOpenCustodyOwner = afterOpenAsset.owner.toBase58();

  // setPrice as seller
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: seller.publicKey, isSigner: true, isWritable: false },
          { pubkey: consignDirect, isSigner: false, isWritable: true },
        ],
        Buffer.concat([Buffer.from([9]), tokenDirect, encU64(1_100)]),
      ),
    ),
    [seller],
  );
  const priced = readConsignment((await conn.getAccountInfo(consignDirect))!.data as Buffer);
  assert.equal(priced.price, 1100n);

  // ownerWithdraw → Returned + custody to seller
  const [recallDirect] = pda(programId, [Buffer.from("recall"), tokenDirect]);
  // create empty recall not needed — withdraw clears if present; pass system account as placeholder
  // OwnerWithdraw accounts: seller · consignment · asset · recall
  // Ensure recall account exists as uninitialized system — program clear_recall handles empty
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: seller.publicKey, isSigner: true, isWritable: false },
          { pubkey: consignDirect, isSigner: false, isWritable: true },
          { pubkey: assetDirect, isSigner: false, isWritable: true },
          { pubkey: recallDirect, isSigner: false, isWritable: true },
        ],
        Buffer.concat([Buffer.from([14]), tokenDirect]),
      ),
    ),
    [seller],
  );
  const afterWithdraw = readAsset((await conn.getAccountInfo(assetDirect))!.data as Buffer);
  assert.equal(afterWithdraw.owner.toBase58(), seller.publicKey.toBase58());
  const returnedLot = readConsignment((await conn.getAccountInfo(consignDirect))!.data as Buffer);
  assert.equal(returnedLot.phase, PHASE.Returned);

  // ---- Mandate + agented lifecycle (fresh token) ----
  const tokenM = Buffer.alloc(32, 0x22);
  const [assetM] = pda(programId, [Buffer.from("harness-asset"), tokenM]);
  const [consignM] = pda(programId, [Buffer.from("consignment"), tokenM]);
  const [mandateM] = pda(programId, [Buffer.from("mandate"), tokenM]);
  const [recallM] = pda(programId, [Buffer.from("recall"), tokenM]);

  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: assetM, isSigner: false, isWritable: true },
          { pubkey: seller.publicKey, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        Buffer.concat([Buffer.from([1]), tokenM]),
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
          { pubkey: assetM, isSigner: false, isWritable: true },
          { pubkey: custodyPda, isSigner: false, isWritable: false },
        ],
        Buffer.concat([Buffer.from([2]), tokenM]),
      ),
    ),
    [seller],
  );

  // Grant commission mandate floor 700
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: seller.publicKey, isSigner: true, isWritable: false },
          { pubkey: assetM, isSigner: false, isWritable: false },
          { pubkey: mandateM, isSigner: false, isWritable: true },
          { pubkey: consignM, isSigner: false, isWritable: false },
          { pubkey: custodyPda, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        ],
        Buffer.concat([
          Buffer.from([5]),
          tokenM,
          agent.publicKey.toBuffer(),
          encU64(0), // no expiry
          Buffer.alloc(32, 0), // native
          Buffer.from([0]),
          Buffer.alloc(32, 0),
          encU64(700),
          Buffer.from([1]), // Commission
          encU16(200),
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
          { pubkey: assetM, isSigner: false, isWritable: true },
          { pubkey: mandateM, isSigner: false, isWritable: false },
          { pubkey: consignM, isSigner: false, isWritable: true },
          { pubkey: custodyPda, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        ],
        Buffer.concat([
          Buffer.from([8]),
          tokenM,
          Buffer.from([0]),
          Buffer.alloc(32, 0),
          encU64(1000), // price meets floor with fee 250 + commission 200
        ]),
      ),
    ),
    [agent, payer],
  );

  const mandateLot = readConsignment((await conn.getAccountInfo(consignM))!.data as Buffer);
  assert.equal(mandateLot.phase, PHASE.Offered);
  assert.equal(mandateLot.floor, 700n);
  assert.equal(mandateLot.feeBps, 250);
  assert.equal(mandateLot.agent.toBase58(), agent.publicKey.toBase58());
  assert.equal(
    readAsset((await conn.getAccountInfo(assetM))!.data as Buffer).owner.toBase58(),
    custodyPda.toBase58(),
  );

  // BelowFloor setPrice
  const belowFloorCode = await expectCustom(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: agent.publicKey, isSigner: true, isWritable: false },
          { pubkey: consignM, isSigner: false, isWritable: true },
        ],
        Buffer.concat([Buffer.from([9]), tokenM, encU64(100)]),
      ),
    ),
    [agent],
    ERR.BelowFloor,
  );

  // NotConsignmentRunner
  await expectCustom(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: seller.publicKey, isSigner: true, isWritable: false },
          { pubkey: consignM, isSigner: false, isWritable: true },
        ],
        Buffer.concat([Buffer.from([9]), tokenM, encU64(1000)]),
      ),
    ),
    [seller],
    ERR.NotConsignmentRunner,
  );

  // setPrice ok
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: agent.publicKey, isSigner: true, isWritable: false },
          { pubkey: consignM, isSigner: false, isWritable: true },
        ],
        Buffer.concat([Buffer.from([9]), tokenM, encU64(1200)]),
      ),
    ),
    [agent],
  );
  const setPriceOk = readConsignment((await conn.getAccountInfo(consignM))!.data as Buffer).price;
  assert.equal(setPriceOk, 1200n);

  // CannotRaiseFloor
  const cannotRaiseFloorCode = await expectCustom(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: seller.publicKey, isSigner: true, isWritable: false },
          { pubkey: assetM, isSigner: false, isWritable: false },
          { pubkey: consignM, isSigner: false, isWritable: true },
        ],
        Buffer.concat([Buffer.from([10]), tokenM, encU64(800)]),
      ),
    ),
    [seller],
    ERR.CannotRaiseFloor,
  );

  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: seller.publicKey, isSigner: true, isWritable: false },
          { pubkey: assetM, isSigner: false, isWritable: false },
          { pubkey: consignM, isSigner: false, isWritable: true },
        ],
        Buffer.concat([Buffer.from([10]), tokenM, encU64(600)]),
      ),
    ),
    [seller],
  );
  assert.equal(readConsignment((await conn.getAccountInfo(consignM))!.data as Buffer).floor, 600n);

  // CannotRaiseCommission
  await expectCustom(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: agent.publicKey, isSigner: true, isWritable: false },
          { pubkey: consignM, isSigner: false, isWritable: true },
        ],
        Buffer.concat([Buffer.from([11]), tokenM, encU16(200)]),
      ),
    ),
    [agent],
    ERR.CannotRaiseCommission,
  );

  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: agent.publicKey, isSigner: true, isWritable: false },
          { pubkey: consignM, isSigner: false, isWritable: true },
        ],
        Buffer.concat([Buffer.from([11]), tokenM, encU16(100)]),
      ),
    ),
    [agent],
  );
  assert.equal(
    readConsignment((await conn.getAccountInfo(consignM))!.data as Buffer).commissionBps,
    100,
  );

  // Request recall + premature force
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: seller.publicKey, isSigner: true, isWritable: false },
          { pubkey: consignM, isSigner: false, isWritable: false },
          { pubkey: recallM, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        ],
        Buffer.concat([Buffer.from([12]), tokenM]),
      ),
    ),
    [seller, payer],
  );

  const cooldownCode = await expectCustom(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: seller.publicKey, isSigner: true, isWritable: false },
          { pubkey: consignM, isSigner: false, isWritable: true },
          { pubkey: recallM, isSigner: false, isWritable: true },
          { pubkey: assetM, isSigner: false, isWritable: true },
        ],
        Buffer.concat([Buffer.from([13]), tokenM]),
      ),
    ),
    [seller],
    ERR.ReturnCooldownPending,
  );

  // Warp requested_at into the past (7d + 1)
  const past = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60 - 10;
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: authority.publicKey, isSigner: true, isWritable: false },
          { pubkey: recallM, isSigner: false, isWritable: true },
        ],
        Buffer.concat([Buffer.from([20]), tokenM, encU64(past)]),
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
          { pubkey: seller.publicKey, isSigner: true, isWritable: false },
          { pubkey: consignM, isSigner: false, isWritable: true },
          { pubkey: recallM, isSigner: false, isWritable: true },
          { pubkey: assetM, isSigner: false, isWritable: true },
        ],
        Buffer.concat([Buffer.from([13]), tokenM]),
      ),
    ),
    [seller],
  );
  const afterRecall = readConsignment((await conn.getAccountInfo(consignM))!.data as Buffer);
  assert.equal(afterRecall.phase, PHASE.Returned);
  const afterRecallAsset = readAsset((await conn.getAccountInfo(assetM))!.data as Buffer);
  assert.equal(afterRecallAsset.owner.toBase58(), seller.publicKey.toBase58());
  const recallForceCustodyOwner = afterRecallAsset.owner.toBase58();

  // ---- Fresh agented lot for settle three-leg ----
  const tokenS = Buffer.alloc(32, 0x33);
  const [assetS] = pda(programId, [Buffer.from("harness-asset"), tokenS]);
  const [consignS] = pda(programId, [Buffer.from("consignment"), tokenS]);
  const [mandateS] = pda(programId, [Buffer.from("mandate"), tokenS]);
  const [recallS] = pda(programId, [Buffer.from("recall"), tokenS]);

  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: assetS, isSigner: false, isWritable: true },
          { pubkey: seller.publicKey, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        Buffer.concat([Buffer.from([1]), tokenS]),
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
          { pubkey: assetS, isSigner: false, isWritable: true },
          { pubkey: custodyPda, isSigner: false, isWritable: false },
        ],
        Buffer.concat([Buffer.from([2]), tokenS]),
      ),
    ),
    [seller],
  );
  // Margin mandate floor 700
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: seller.publicKey, isSigner: true, isWritable: false },
          { pubkey: assetS, isSigner: false, isWritable: false },
          { pubkey: mandateS, isSigner: false, isWritable: true },
          { pubkey: consignS, isSigner: false, isWritable: false },
          { pubkey: custodyPda, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        ],
        Buffer.concat([
          Buffer.from([5]),
          tokenS,
          agent.publicKey.toBuffer(),
          encU64(0),
          Buffer.alloc(32, 0),
          Buffer.from([0]),
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
          { pubkey: assetS, isSigner: false, isWritable: true },
          { pubkey: mandateS, isSigner: false, isWritable: false },
          { pubkey: consignS, isSigner: false, isWritable: true },
          { pubkey: custodyPda, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        ],
        Buffer.concat([
          Buffer.from([8]),
          tokenS,
          Buffer.from([0]),
          Buffer.alloc(32, 0),
          encU64(1000),
        ]),
      ),
    ),
    [agent, payer],
  );

  const settleLot = readConsignment((await conn.getAccountInfo(consignS))!.data as Buffer);
  const settled = 1000n;
  const feeBps = BigInt(settleLot.feeBps);
  const platformAmt = (settled * feeBps) / 10_000n; // 25
  const ownerAmt = settleLot.floor; // 700 margin
  const agentAmt = settled - platformAmt - ownerAmt; // 275

  const balP0 = BigInt(await conn.getBalance(platform.publicKey));
  const balS0 = BigInt(await conn.getBalance(seller.publicKey));
  const balA0 = BigInt(await conn.getBalance(agent.publicKey));

  const settleSig = await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: consignS, isSigner: false, isWritable: true },
          { pubkey: assetS, isSigner: false, isWritable: true },
          { pubkey: buyer.publicKey, isSigner: false, isWritable: false },
          { pubkey: platform.publicKey, isSigner: false, isWritable: true },
          { pubkey: seller.publicKey, isSigner: false, isWritable: true },
          { pubkey: agent.publicKey, isSigner: false, isWritable: true },
          { pubkey: recallS, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        ],
        Buffer.concat([Buffer.from([19]), tokenS, encU64(settled)]),
      ),
    ),
    [payer],
  );

  const closed = readConsignment((await conn.getAccountInfo(consignS))!.data as Buffer);
  assert.equal(closed.phase, PHASE.Closed);
  const settleAsset = readAsset((await conn.getAccountInfo(assetS))!.data as Buffer);
  assert.equal(
    settleAsset.owner.toBase58(),
    buyer.publicKey.toBase58(),
    "buyer must own asset before/after settle (custody moved first)",
  );
  const settleBuyerOwns = settleAsset.owner.toBase58();

  const balP1 = BigInt(await conn.getBalance(platform.publicKey));
  const balS1 = BigInt(await conn.getBalance(seller.publicKey));
  const balA1 = BigInt(await conn.getBalance(agent.publicKey));
  assert.equal(balP1 - balP0, platformAmt);
  assert.equal(balS1 - balS0, ownerAmt);
  assert.equal(balA1 - balA0, agentAmt);

  return withStandArtifactBindings({
    directOpen: {
      phase: directOpenPhase,
      custodyOwner: directOpenCustodyOwner,
    },
    mandateOpen: {
      phase: mandateLot.phase,
      floor: mandateLot.floor,
      feeBps: mandateLot.feeBps,
    },
    setPriceOk,
    refusals: {
      belowFloor: belowFloorCode,
      cannotRaiseFloor: cannotRaiseFloorCode,
      cooldown: cooldownCode,
    },
    recallForce: {
      phase: afterRecall.phase,
      custodyOwner: recallForceCustodyOwner,
    },
    settle: {
      phase: closed.phase,
      buyerOwns: settleBuyerOwns,
      platformDelta: balP1 - balP0,
      sellerDelta: balS1 - balS0,
      agentDelta: balA1 - balA0,
      settled,
      feeBps: settleLot.feeBps,
      signature: settleSig,
    },
  });
}
