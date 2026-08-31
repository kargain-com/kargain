/**
 * Local-validator proof: SPL payout reachability-before-attempt (S6 #1-fix).
 *
 * Cases:
 * - absent recipient ATA → settlement completes; claim credited; withdraw after ATA created
 * - frozen recipient ATA → inbound blocked by spl-token (0x11); claim + withdraw
 *   to a fresh unfrozen ATA (validator finding: Frozen is unreachable)
 *
 * Requires: local validator at SVM_STAND_RPC (default 127.0.0.1:8899),
 * money_harness.so preloaded or deployable.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Resolve Solana packages from the lab package (not a root dependency). */
const require = createRequire(path.resolve(__dirname, "../lab/package.json"));
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  SYSVAR_RENT_PUBKEY,
} = require("@solana/web3.js") as typeof import("@solana/web3.js");
const {
  TOKEN_PROGRAM_ID,
  createInitializeMint2Instruction,
  createInitializeAccount3Instruction,
  createMintToInstruction,
  createFreezeAccountInstruction,
  getMinimumBalanceForRentExemptMint,
  getMinimumBalanceForRentExemptAccount,
  getAccount,
} = require("@solana/spl-token") as typeof import("@solana/spl-token");

const ROOT = path.resolve(__dirname, "../..");
const RPC = process.env.SVM_STAND_RPC ?? "http://127.0.0.1:8899";
const DEPLOY = path.join(ROOT, "svm/target/deploy");

function borshPayLeg(amount: bigint): Buffer {
  const buf = Buffer.alloc(1 + 8);
  buf.writeUInt8(0, 0); // PayLeg
  buf.writeBigUInt64LE(amount, 1);
  return buf;
}

function borshWithdrawClaim(): Buffer {
  const buf = Buffer.alloc(1);
  buf.writeUInt8(1, 0);
  return buf;
}

function claimPda(programId: InstanceType<typeof PublicKey>, recipient: InstanceType<typeof PublicKey>, mint: InstanceType<typeof PublicKey>): [InstanceType<typeof PublicKey>, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("claim"), recipient.toBuffer(), mint.toBuffer()],
    programId,
  );
}

function claimAtaPda(
  programId: InstanceType<typeof PublicKey>,
  recipient: InstanceType<typeof PublicKey>,
  mint: InstanceType<typeof PublicKey>,
): [InstanceType<typeof PublicKey>, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("claim-ata"), recipient.toBuffer(), mint.toBuffer()],
    programId,
  );
}

async function airdrop(conn: InstanceType<typeof Connection>, kp: InstanceType<typeof Keypair>, sol = 10) {
  const sig = await conn.requestAirdrop(kp.publicKey, sol * 1e9);
  await conn.confirmTransaction(sig, "confirmed");
}

function loadHarnessProgramId(): InstanceType<typeof PublicKey> {
  const kpPath = path.join(DEPLOY, "money_harness-keypair.json");
  if (!existsSync(kpPath)) {
    throw new Error(`missing ${kpPath} — build money-harness with cargo-build-sbf`);
  }
  const secret = Uint8Array.from(JSON.parse(readFileSync(kpPath, "utf8")));
  return Keypair.fromSecretKey(secret).publicKey;
}

async function createMint(
  conn: InstanceType<typeof Connection>,
  payer: InstanceType<typeof Keypair>,
  freezeAuthority: InstanceType<typeof PublicKey>,
): Promise<InstanceType<typeof PublicKey>> {
  const mint = Keypair.generate();
  const lamports = await getMinimumBalanceForRentExemptMint(conn);
  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint.publicKey,
      space: 82,
      lamports,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMint2Instruction(mint.publicKey, 6, payer.publicKey, freezeAuthority),
  );
  await sendAndConfirmTransaction(conn, tx, [payer, mint]);
  return mint.publicKey;
}

async function createTokenAccount(
  conn: InstanceType<typeof Connection>,
  payer: InstanceType<typeof Keypair>,
  mint: InstanceType<typeof PublicKey>,
  owner: InstanceType<typeof PublicKey>,
): Promise<InstanceType<typeof PublicKey>> {
  const account = Keypair.generate();
  const lamports = await getMinimumBalanceForRentExemptAccount(conn);
  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: account.publicKey,
      space: 165,
      lamports,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeAccount3Instruction(account.publicKey, mint, owner),
  );
  await sendAndConfirmTransaction(conn, tx, [payer, account]);
  return account.publicKey;
}

export async function probeValidator(rpc = RPC): Promise<boolean> {
  try {
    const res = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getHealth",
        params: [],
      }),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { result?: string };
    return body.result === "ok";
  } catch {
    return false;
  }
}

export async function runLiveMoneyPayoutProof(opts?: {
  rpc?: string;
  programId?: InstanceType<typeof PublicKey>;
}): Promise<{
  absentCase: { settled: boolean; claimAmount: bigint; withdrawn: bigint };
  frozenCase: { inboundBlocked: boolean; claimAmount: bigint; withdrawn: bigint };
}> {
  const rpc = opts?.rpc ?? RPC;
  const conn = new Connection(rpc, "confirmed");
  const programId = opts?.programId ?? loadHarnessProgramId();

  const payer = Keypair.generate();
  await airdrop(conn, payer, 20);

  const mint = await createMint(conn, payer, payer.publicKey);
  const escrowAuthority = payer;
  const escrowAta = await createTokenAccount(conn, payer, mint, escrowAuthority.publicKey);
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      createMintToInstruction(mint, escrowAta, payer.publicKey, 1_000_000n),
    ),
    [payer],
  );

  const platform = Keypair.generate();
  const seller = Keypair.generate();
  const agent = Keypair.generate();
  await airdrop(conn, seller, 2);

  const platformAta = await createTokenAccount(conn, payer, mint, platform.publicKey);
  const agentAta = await createTokenAccount(conn, payer, mint, agent.publicKey);
  // seller ATA deliberately absent for first settle

  const P = 25n;
  const O = 700n;
  const A = 275n;

  async function payLeg(
    recipientWallet: InstanceType<typeof PublicKey>,
    recipientAta: InstanceType<typeof PublicKey>,
    amount: bigint,
  ) {
    const [claim] = claimPda(programId, recipientWallet, mint);
    const [claimAta] = claimAtaPda(programId, recipientWallet, mint);
    const ix = new TransactionInstruction({
      programId,
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: escrowAta, isSigner: false, isWritable: true },
        { pubkey: escrowAuthority.publicKey, isSigner: true, isWritable: false },
        { pubkey: recipientWallet, isSigner: false, isWritable: false },
        { pubkey: recipientAta, isSigner: false, isWritable: true },
        { pubkey: claim, isSigner: false, isWritable: true },
        { pubkey: claimAta, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      ],
      data: borshPayLeg(amount),
    });
    await sendAndConfirmTransaction(conn, new Transaction().add(ix), [
      payer,
      escrowAuthority,
    ]);
  }

  // --- Absent seller ATA ---
  const absentPlaceholder = Keypair.generate().publicKey; // empty system account as meta
  await payLeg(platform.publicKey, platformAta, P);
  await payLeg(seller.publicKey, absentPlaceholder, O);
  await payLeg(agent.publicKey, agentAta, A);

  const platformBal = (await getAccount(conn, platformAta)).amount;
  const agentBal = (await getAccount(conn, agentAta)).amount;
  /** Derived: reachable legs received exact amounts (not a literal). */
  const settled = platformBal === P && agentBal === A;

  const [sellerClaim] = claimPda(programId, seller.publicKey, mint);
  const [sellerClaimAta] = claimAtaPda(programId, seller.publicKey, mint);
  const claimAcc = await conn.getAccountInfo(sellerClaim);
  assert.ok(claimAcc, "claim PDA must exist after unreachable pay");
  // amount at offset 8+32+32 = 72
  const claimAmount = claimAcc!.data.readBigUInt64LE(72);
  const claimTok = await getAccount(conn, sellerClaimAta);
  assert.equal(claimTok.amount, claimAmount, "claim ATA must hold recorded amount");

  // Create seller ATA and withdraw
  const sellerAta = await createTokenAccount(conn, payer, mint, seller.publicKey);
  const withdrawIx = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: seller.publicKey, isSigner: true, isWritable: false },
      { pubkey: sellerClaim, isSigner: false, isWritable: true },
      { pubkey: sellerClaimAta, isSigner: false, isWritable: true },
      { pubkey: sellerAta, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: borshWithdrawClaim(),
  });
  await sendAndConfirmTransaction(conn, new Transaction().add(withdrawIx), [seller]);
  const withdrawn = (await getAccount(conn, sellerAta)).amount;

  // --- Frozen destination → claim (validator: inbound transfer fails with 0x11) ---
  const frozenOwner = Keypair.generate();
  await airdrop(conn, frozenOwner, 2);
  const frozenAta = await createTokenAccount(conn, payer, mint, frozenOwner.publicKey);
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(createFreezeAccountInstruction(frozenAta, mint, payer.publicKey)),
    [payer],
  );

  const F = 500n;
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      createMintToInstruction(mint, escrowAta, payer.publicKey, F),
    ),
    [payer],
  );

  const frozenBalBefore = (await getAccount(conn, frozenAta)).amount;
  await payLeg(frozenOwner.publicKey, frozenAta, F);
  const frozenBalAfter = (await getAccount(conn, frozenAta)).amount;
  /** Derived: frozen destination balance unchanged (inbound blocked). */
  const inboundBlocked = frozenBalAfter === frozenBalBefore;

  const [frozenClaim] = claimPda(programId, frozenOwner.publicKey, mint);
  const [frozenClaimAta] = claimAtaPda(programId, frozenOwner.publicKey, mint);
  const frozenClaimInfo = await conn.getAccountInfo(frozenClaim);
  assert.ok(frozenClaimInfo, "frozen destination must credit a claim");
  const frozenClaimAmount = frozenClaimInfo!.data.readBigUInt64LE(72);
  assert.equal(
    (await getAccount(conn, frozenClaimAta)).amount,
    frozenClaimAmount,
    "frozen claim ATA must hold recorded amount",
  );

  // Withdraw to a fresh unfrozen ATA for the same owner
  const thawedAta = await createTokenAccount(conn, payer, mint, frozenOwner.publicKey);
  const frozenWithdrawIx = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: frozenOwner.publicKey, isSigner: true, isWritable: false },
      { pubkey: frozenClaim, isSigner: false, isWritable: true },
      { pubkey: frozenClaimAta, isSigner: false, isWritable: true },
      { pubkey: thawedAta, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: borshWithdrawClaim(),
  });
  await sendAndConfirmTransaction(conn, new Transaction().add(frozenWithdrawIx), [
    frozenOwner,
  ]);
  const frozenWithdrawn = (await getAccount(conn, thawedAta)).amount;

  return {
    absentCase: { settled, claimAmount, withdrawn },
    frozenCase: {
      inboundBlocked,
      claimAmount: frozenClaimAmount,
      withdrawn: frozenWithdrawn,
    },
  };
}

export function liveMoneyPayoutModuleId(): string {
  return createHash("sha256").update("s6-1-fix-live-money-payout").digest("hex").slice(0, 16);
}
