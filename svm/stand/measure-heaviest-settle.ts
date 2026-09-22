/**
 * S7a D-28 heaviest settle fixture — FixedPrice Buy (SPL, agented Margin, absent seller ATA).
 *
 * Core + passport path (S8-E step 5): MintPassport → TransferDelegate → Grant →
 * OpenFromMandate → Buy. Margin S=1000, p=250 bps → P=25 / O=700 / A=275.
 * Emits Bought + ConsignmentSplitPaid + ConsignmentClosed + ClaimRecorded in one Buy ix.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ENCUMBRANCE_SEED_PREFIX,
  FP_IX,
  RPC_DEFAULT,
  SEED,
  airdrop,
  addEncumbranceSource,
  addTransferDelegateToCustody,
  answerPdas,
  bindPassportProgram,
  buyHeadKeys,
  encU16,
  encU64,
  ensurePassportCommerceStack,
  grantKeys,
  ix,
  loadDeployProgramId,
  mintPassportAsset,
  openFromMandateKeys,
  pda,
  sendIxWithAlt,
} from "./stand-passport-commerce.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(__dirname, "../lab/package.json"));
const {
  Connection,
  Keypair,
  SystemProgram,
  Transaction,
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

const RPC = RPC_DEFAULT;
const FORM_MARGIN = 0;

export type HeaviestSettleMeasure = {
  signature: string;
  ixName: "Buy";
  fixtureDescription: string;
  legacyWouldBe: number;
  versionedSize: number;
  altNeeded: boolean;
};

export async function runMeasureHeaviestSettle(opts?: {
  rpc?: string;
}): Promise<HeaviestSettleMeasure> {
  const rpc = opts?.rpc ?? RPC;
  const conn = new Connection(rpc, "confirmed");
  const programId = loadDeployProgramId("kar_fixed_price");
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

  const stack = await ensurePassportCommerceStack(conn);

  const feeBps = 250;
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
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        Buffer.concat([Buffer.from([FP_IX.InitConfig]), encU16(feeBps)]),
      ),
    ),
    [payer, authority],
  );

  await addEncumbranceSource(conn, stack, programId, ENCUMBRANCE_SEED_PREFIX);
  const binding = await bindPassportProgram(
    conn,
    programId,
    configPda,
    authority,
    payer,
    stack.passportProgram,
  );
  const [custodyPda] = pda(programId, [SEED.custody]);

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
        Buffer.concat([
          Buffer.from([FP_IX.ApprovePaymentToken]),
          Buffer.alloc(32, 0),
          Buffer.alloc(32, 0),
          Buffer.alloc(4, 0),
          Buffer.alloc(4, 0),
        ]),
      ),
    ),
    [authority, payer],
  );

  const price = 1000n;
  const floor = 700n;
  const { tokenId, asset, challenge } = await mintPassportAsset(
    conn,
    stack,
    payer,
    seller.publicKey,
    "ar://heaviest-settle",
  );
  await addTransferDelegateToCustody(conn, seller, payer, asset, custodyPda);

  const [mandatePb] = pda(programId, [SEED.mandate, tokenId]);
  const [consignPb] = pda(programId, [SEED.consignment, tokenId]);
  const [recallPb] = pda(programId, [SEED.recall, tokenId]);
  const [escrowPb] = pda(programId, [SEED.escrow, tokenId]);
  const answers = answerPdas(programId, tokenId);

  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        grantKeys({
          owner: seller.publicKey,
          binding,
          asset,
          mandate: mandatePb,
          consign: consignPb,
          custody: custodyPda,
          payer: payer.publicKey,
        }),
        Buffer.concat([
          Buffer.from([FP_IX.Grant]),
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
        openFromMandateKeys({
          agent: agent.publicKey,
          config: configPda,
          mandate: mandatePb,
          paymentTok: payTok,
          binding,
          passportConfig: stack.passportConfig,
          asset,
          challenge,
          mayAnswerOpen: answers.open,
          consign: consignPb,
          custody: custodyPda,
          payer: payer.publicKey,
          answerLeave: answers.leave,
          answerOpen: answers.open,
        }),
        Buffer.concat([
          Buffer.from([FP_IX.OpenFromMandate]),
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
    SEED.claim,
    platform.publicKey.toBuffer(),
    mint.publicKey.toBuffer(),
  ]);
  const [platClaimAta] = pda(programId, [
    SEED.claimAta,
    platform.publicKey.toBuffer(),
    mint.publicKey.toBuffer(),
  ]);
  const [sellClaim] = pda(programId, [
    SEED.claim,
    seller.publicKey.toBuffer(),
    mint.publicKey.toBuffer(),
  ]);
  const [sellClaimAta] = pda(programId, [
    SEED.claimAta,
    seller.publicKey.toBuffer(),
    mint.publicKey.toBuffer(),
  ]);
  const [agentClaim] = pda(programId, [
    SEED.claim,
    agent.publicKey.toBuffer(),
    mint.publicKey.toBuffer(),
  ]);
  const [agentClaimAta] = pda(programId, [
    SEED.claimAta,
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

  const buyIx = ix(
    programId,
    [
      ...buyHeadKeys({
        buyer: buyer.publicKey,
        config: configPda,
        consign: consignPb,
        binding,
        passportConfig: stack.passportConfig,
        asset,
        custody: custodyPda,
        platform: platform.publicKey,
        seller: seller.publicKey,
        agent: agent.publicKey,
        recall: recallPb,
        payer: payer.publicKey,
        escrow: escrowPb,
        answerLeave: answers.leave,
        answerOpen: answers.open,
        answerFunder: payer.publicKey,
      }),
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
    Buffer.concat([Buffer.from([FP_IX.Buy]), tokenId]),
  );
  const alt = await sendIxWithAlt(conn, payer, buyIx, [buyer, payer]);

  return {
    signature: alt.signature,
    ixName: "Buy",
    fixtureDescription:
      "kar-fixed-price Buy SPL agented Margin S=1000 p=250bps floor=700 (Core passport); seller ATA absent → ClaimRecorded + split + close",
    legacyWouldBe: alt.legacyWouldBe,
    versionedSize: alt.versionedSize,
    altNeeded: alt.legacyWouldBe > 1232,
  };
}
