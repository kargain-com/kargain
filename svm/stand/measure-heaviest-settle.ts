/**
 * S7a D-28 heaviest settle fixture — FixedPrice Buy (SPL, agented Margin, absent seller ATA).
 *
 * Margin S=1000, p=250 bps → P=25 / O=700 / A=275 (SPEC §13.14 D-23 worked example).
 * Emits Bought + ConsignmentSplitPaid + ConsignmentClosed + ClaimRecorded in one Buy ix.
 */
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  getMinimumBalanceForRentExemptMint,
  getMinimumBalanceForRentExemptAccount,
} = require("@solana/spl-token") as typeof import("@solana/spl-token");

const ROOT = path.resolve(__dirname, "../..");
const RPC = process.env.SVM_STAND_RPC ?? "http://127.0.0.1:8899";
const DEPLOY = path.join(ROOT, "svm/target/deploy");

const IX = {
  InitConfig: 0,
  CreateAsset: 1,
  ApproveEscrow: 2,
  Grant: 5,
  OpenFromMandate: 8,
  ApprovePaymentToken: 19,
  Buy: 21,
} as const;

const FORM_MARGIN = 0;

export type HeaviestSettleMeasure = {
  signature: string;
  ixName: "Buy";
  fixtureDescription: string;
};

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
function encU64(n: bigint | number): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n), 0);
  return b;
}

function encApproveAssetOnly(): Buffer {
  return Buffer.concat([
    Buffer.from([IX.ApprovePaymentToken]),
    Buffer.alloc(32, 0),
    Buffer.alloc(32, 0),
    Buffer.alloc(4, 0),
    Buffer.alloc(4, 0),
  ]);
}

export async function runMeasureHeaviestSettle(opts?: { rpc?: string }): Promise<HeaviestSettleMeasure> {
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

  const [custodyPda] = pda(programId, [Buffer.from("custody")]);
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

  const price = 1000n;
  const floor = 700n;
  const tokenId = Buffer.alloc(32, 0x7a);
  const [assetPb] = pda(programId, [Buffer.from("harness-asset"), tokenId]);
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: assetPb, isSigner: false, isWritable: true },
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
          { pubkey: assetPb, isSigner: false, isWritable: true },
          { pubkey: custodyPda, isSigner: false, isWritable: false },
        ],
        Buffer.concat([Buffer.from([IX.ApproveEscrow]), tokenId]),
      ),
    ),
    [seller],
  );

  const [mandatePb] = pda(programId, [Buffer.from("mandate"), tokenId]);
  const [consignPb] = pda(programId, [Buffer.from("consignment"), tokenId]);
  const [recallPb] = pda(programId, [Buffer.from("recall"), tokenId]);
  const [escrowPb] = pda(programId, [Buffer.from("escrow"), tokenId]);

  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: seller.publicKey, isSigner: true, isWritable: false },
          { pubkey: assetPb, isSigner: false, isWritable: false },
          { pubkey: mandatePb, isSigner: false, isWritable: true },
          { pubkey: consignPb, isSigner: false, isWritable: false },
          { pubkey: custodyPda, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        ],
        Buffer.concat([
          Buffer.from([IX.Grant]),
          tokenId,
          agent.publicKey.toBuffer(),
          encU64(0),
          mint.publicKey.toBuffer(),
          Buffer.from([0]),
          Buffer.alloc(32, 0),
          encU64(floor),
          Buffer.from([FORM_MARGIN]),
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
          { pubkey: assetPb, isSigner: false, isWritable: true },
          { pubkey: mandatePb, isSigner: false, isWritable: false },
          { pubkey: consignPb, isSigner: false, isWritable: true },
          { pubkey: custodyPda, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: payTok, isSigner: false, isWritable: false },
        ],
        Buffer.concat([
          Buffer.from([IX.OpenFromMandate]),
          tokenId,
          Buffer.from([0]),
          Buffer.alloc(32, 0),
          encU64(price),
        ]),
      ),
    ),
    [agent, payer],
  );

  const ataRent = await getMinimumBalanceForRentExemptAccount(conn);
  const buyerAta = Keypair.generate();
  const escrowAta = Keypair.generate();
  const platformAta = Keypair.generate();
  const agentAta = Keypair.generate();
  const absentSellerAta = Keypair.generate().publicKey;

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
  const [agentClaim] = pda(programId, [
    Buffer.from("claim"),
    agent.publicKey.toBuffer(),
    mint.publicKey.toBuffer(),
  ]);
  const [agentClaimAta] = pda(programId, [
    Buffer.from("claim-ata"),
    agent.publicKey.toBuffer(),
    mint.publicKey.toBuffer(),
  ]);

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
      createInitializeAccount3Instruction(escrowAta.publicKey, mint.publicKey, escrowPb),
      createMintToInstruction(mint.publicKey, buyerAta.publicKey, payer.publicKey, Number(price)),
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
        newAccountPubkey: agentAta.publicKey,
        space: 165,
        lamports: ataRent,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeAccount3Instruction(agentAta.publicKey, mint.publicKey, agent.publicKey),
    ),
    [payer, buyerAta, escrowAta, platformAta, agentAta],
  );

  const sig = await sendAndConfirmTransaction(
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
          { pubkey: buyerAta.publicKey, isSigner: false, isWritable: true },
          { pubkey: escrowAta.publicKey, isSigner: false, isWritable: true },
          { pubkey: mint.publicKey, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: platformAta.publicKey, isSigner: false, isWritable: true },
          { pubkey: platClaim, isSigner: false, isWritable: true },
          { pubkey: platClaimAta, isSigner: false, isWritable: true },
          { pubkey: absentSellerAta, isSigner: false, isWritable: true },
          { pubkey: sellClaim, isSigner: false, isWritable: true },
          { pubkey: sellClaimAta, isSigner: false, isWritable: true },
          { pubkey: agentAta.publicKey, isSigner: false, isWritable: true },
          { pubkey: agentClaim, isSigner: false, isWritable: true },
          { pubkey: agentClaimAta, isSigner: false, isWritable: true },
        ],
        Buffer.concat([Buffer.from([IX.Buy]), tokenId]),
      ),
    ),
    [buyer, payer],
  );

  return {
    signature: sig,
    ixName: "Buy",
    fixtureDescription:
      "kar-fixed-price Buy SPL agented Margin S=1000 p=250bps floor=700; seller ATA absent → ClaimRecorded + split + close",
  };
}
