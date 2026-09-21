/**
 * Local-validator proof: FixedPrice Core + passport path (S8-E step 5).
 *
 * Asserts chain state (never success-only / invented return constants):
 * - Corrective negatives: unbound OpenDirect(140); rebind AAI; Send→OpenDirect NotPassportOwner(79);
 *   registry miss(71); retired harness(141); live-lot Send LeaveChainRefused(37) then Send ok after close
 *   registry-miss OpenDirect(71); retired CreateAsset(141)
 * - Native buy: pull → buyer owns Core asset → three-leg deltas = fee snapshot split
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
 * - May(LeaveChain) refused while live / allowed after close
 * - After Revoke: TransferDelegate still present; OpenFromMandate → NoMandate (not NotTransferDelegate)
 *
 * Requires: local validator, kar_fixed_price + kar_passport + mpl-core preloaded.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  withStandArtifactBindings,
  type StandArtifactBindings,
} from "./stand-artifact-bindings.ts";
import {
  CORE_ID,
  ENCUMBRANCE_SEED_PREFIX,
  FP_IX,
  RPC_DEFAULT,
  SEED,
  airdrop,
  addEncumbranceSource,
  addTransferDelegateToCustody,
  answerPdas,
  bindPassportProgramIx,
  buyHeadKeys,
  confirmExternalKeys,
  coreOwner,
  encI64,
  encU16,
  encU32,
  encU64,
  ensurePassportCommerceStack,
  expectAccountAlreadyInitialized,
  expectCustom,
  grantKeys,
  hasTransferDelegateAddress,
  isPermanentlyFrozen,
  ix,
  loadDeployProgramId,
  mintPassportAsset,
  openDirectKeys,
  openFromMandateKeys,
  passportStateCustodyLocked,
  pda,
  sendAndMeasure,
  sendIxWithAlt,
  tryGatewaySend,
  withOpenAnswers,
  type Conn,
  type IxBudgetRow,
  type Kp,
  type Meta,
  type Pk,
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
const RPC = RPC_DEFAULT;

const ERR = {
  ContractPaused: 76,
  TransferFeeExtensionForbidden: 69,
  ModeNotEncumbranceSource: 71,
  CurrencyNotAvailableOnChain: 133,
  PaymentTokenFeedRequired: 124,
  StalePrice: 122,
  BadOracleAnswer: 123,
  ConfidenceTooWide: 131,
  LeaveChainRefused: 37,
  NoMandate: 84,
  NotPassportOwner: 79,
  PassportProgramUnbound: 140,
  HarnessInstructionRetired: 141,
} as const;

const PHASE = { Offered: 1, Closed: 2 } as const;
const FORM_MARGIN = 0;
const FORM_COMMISSION = 1;
const DENOM_FIAT = 1;
const DENOM_ASSET = 0;

/** Shared terminate metas (ForceRecall / OwnerWithdraw / AgentWithdraw). */
function terminateKeys(args: {
  caller: Pk;
  consign: Pk;
  recall: Pk;
  binding: Pk;
  passportConfig: Pk;
  asset: Pk;
  custody: Pk;
  recipient: Pk;
  payer: Pk;
  answerLeave: Pk;
  answerOpen: Pk;
}): Meta[] {
  return [
    { pubkey: args.caller, isSigner: true, isWritable: false },
    { pubkey: args.consign, isSigner: false, isWritable: true },
    { pubkey: args.recall, isSigner: false, isWritable: true },
    { pubkey: args.binding, isSigner: false, isWritable: false },
    { pubkey: args.passportConfig, isSigner: false, isWritable: false },
    { pubkey: args.asset, isSigner: false, isWritable: true },
    { pubkey: args.custody, isSigner: false, isWritable: false },
    { pubkey: args.recipient, isSigner: false, isWritable: false },
    { pubkey: args.payer, isSigner: true, isWritable: true },
    { pubkey: CORE_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: args.answerLeave, isSigner: false, isWritable: true },
    { pubkey: args.answerOpen, isSigner: false, isWritable: true },
  ];
}

const FIXTURES = path.join(ROOT, "svm/lab/fixtures/price-measure");
const LAB_FEED_ID = Buffer.from(
  "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
  "hex",
);
const CURRENCY_USD = Buffer.concat([Buffer.from("USD"), Buffer.alloc(29)]);

function loadProgramId(): Pk {
  return loadDeployProgramId("kar_fixed_price");
}

function encApproveAssetOnly(): Buffer {
  return Buffer.concat([
    Buffer.from([FP_IX.ApprovePaymentToken]),
    Buffer.alloc(32, 0),
    Buffer.alloc(32, 0),
    encU32(0),
    encU32(0),
  ]);
}

function encApproveWithFeed(
  priceProgram: Pk,
  feedId: Buffer,
  staleness: number,
  maxConfBps: number,
): Buffer {
  return Buffer.concat([
    Buffer.from([FP_IX.ApprovePaymentToken]),
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

function readConsignment(data: Buffer): {
  price: bigint;
  phase: number;
  feeBps: number;
  floor: bigint;
} {
  let o = 8 + 32 + 32 + 32 + 32;
  o += 1 + 32;
  const floor = data.readBigUInt64LE(o);
  o += 8;
  o += 1 + 2;
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
  conn: Conn,
  programId: Pk,
  payer: Kp,
  authority: Kp,
  platform: Kp,
  guardian: Kp,
  feeBps: number,
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
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        Buffer.concat([Buffer.from([FP_IX.InitConfig]), encU16(feeBps)]),
      ),
    ),
    [payer, authority],
  );
  return configPda;
}

type Minted = {
  tokenId: Buffer;
  asset: Pk;
  challenge: Pk;
  consign: Pk;
  recall: Pk;
  escrow: Pk;
  answers: { leave: Pk; open: Pk };
};

async function mintCoreLot(
  conn: Conn,
  stack: Awaited<ReturnType<typeof ensurePassportCommerceStack>>,
  programId: Pk,
  payer: Kp,
  seller: Kp,
): Promise<Minted> {
  const { tokenId, asset, challenge } = await mintPassportAsset(
    conn,
    stack,
    payer,
    seller.publicKey,
  );
  const [consign] = pda(programId, [SEED.consignment, tokenId]);
  const [recall] = pda(programId, [SEED.recall, tokenId]);
  const [escrow] = pda(programId, [SEED.escrow, tokenId]);
  const answers = answerPdas(programId, tokenId);
  return { tokenId, asset, challenge, consign, recall, escrow, answers };
}

async function openDirectNative(
  conn: Conn,
  ctx: {
    programId: Pk;
    configPda: Pk;
    binding: Pk;
    stack: Awaited<ReturnType<typeof ensurePassportCommerceStack>>;
    custodyPda: Pk;
    payer: Kp;
    seller: Kp;
  },
  lot: Minted,
  price: bigint,
) {
  const keys = withOpenAnswers(
    openDirectKeys({
      seller: ctx.seller.publicKey,
      config: ctx.configPda,
      binding: ctx.binding,
      passportConfig: ctx.stack.passportConfig,
      asset: lot.asset,
      challenge: lot.challenge,
      mayAnswerOpen: lot.answers.open,
      consign: lot.consign,
      custody: ctx.custodyPda,
      payer: ctx.payer.publicKey,
    }),
    lot.answers.leave,
    lot.answers.open,
  );
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        ctx.programId,
        keys,
        Buffer.concat([
          Buffer.from([FP_IX.OpenDirect]),
          lot.tokenId,
          Buffer.alloc(32, 0),
          Buffer.from([0]),
          Buffer.alloc(32, 0),
          encU64(price),
        ]),
      ),
    ),
    [ctx.seller, ctx.payer],
  );
}

async function openDirectSpl(
  conn: Conn,
  ctx: {
    programId: Pk;
    configPda: Pk;
    binding: Pk;
    stack: Awaited<ReturnType<typeof ensurePassportCommerceStack>>;
    custodyPda: Pk;
    payer: Kp;
    seller: Kp;
  },
  lot: Minted,
  mint: Pk,
  payTok: Pk,
  denomKind: number,
  currency: Buffer,
  price: bigint,
) {
  const keys = withOpenAnswers(
    openDirectKeys({
      seller: ctx.seller.publicKey,
      config: ctx.configPda,
      paymentTok: payTok,
      binding: ctx.binding,
      passportConfig: ctx.stack.passportConfig,
      asset: lot.asset,
      challenge: lot.challenge,
      mayAnswerOpen: lot.answers.open,
      consign: lot.consign,
      custody: ctx.custodyPda,
      payer: ctx.payer.publicKey,
    }),
    lot.answers.leave,
    lot.answers.open,
  );
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        ctx.programId,
        keys,
        Buffer.concat([
          Buffer.from([FP_IX.OpenDirect]),
          lot.tokenId,
          mint.toBuffer(),
          Buffer.from([denomKind]),
          currency,
          encU64(price),
        ]),
      ),
    ),
    [ctx.seller, ctx.payer],
  );
}

export async function runLiveFixedPrice(opts?: { rpc?: string }): Promise<{
  unboundOpenCode: number;
  rebindCode: "AccountAlreadyInitialized";
  frozenOpenCode: number;
  frozenCustodyLocked: boolean;
  frozenPermanentFreeze: boolean;
  registryMissCode: number;
  retiredIxCode: number;
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
  fiatAgented: {
    floorBefore: bigint;
    floorAfter: bigint;
    expectedFloorAsset: bigint;
    ownerDelta: bigint;
    agentDelta: bigint;
    platformDelta: bigint;
    amount: bigint;
    buyLegacyWouldBe: number;
    buyVersionedSize: number;
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
  splBuySettledTotal: bigint;
  admittedDecimals: number;
  chainMintDecimals: number;
  transferFeeRefuseCode: number;
  leaveChainWhileLive: number;
  leaveChainAfterClose: null;
  leaveChainSendWhileLive: number;
  leaveChainSendAfterClose: null;
  revokeOpenCode: number;
  transferDelegateAfterRevoke: boolean;
  /** Per-ix metas/CU/tx on stand with passport registry N=1. */
  ixBudget: Record<string, IxBudgetRow>;
  ixBudgetHeaviest: string;
  artifacts: StandArtifactBindings;
}> {
  const rpc = opts?.rpc ?? RPC;
  const conn = new Connection(rpc, "confirmed");
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

  const stack = await ensurePassportCommerceStack(conn);
  const feeBps = 250;
  const configPda = await initMode(conn, programId, payer, authority, platform, guardian, feeBps);
  const [custodyPda] = pda(programId, [SEED.custody]);
  const [bindingPda] = pda(programId, [SEED.passportBind]);

  // ---- Corrective negatives (order: unbound → bind → rebind → registry miss → registry → frozen → retired) ----

  // 1. Unbound open: mint + OpenDirect with empty binding PDA → PassportProgramUnbound(140)
  const lotUnbound = await mintCoreLot(conn, stack, programId, payer, seller);
  const unboundOpenCode = await expectCustom(
    conn,
    new Transaction().add(
      ix(
        programId,
        withOpenAnswers(
          openDirectKeys({
            seller: seller.publicKey,
            config: configPda,
            binding: bindingPda,
            passportConfig: stack.passportConfig,
            asset: lotUnbound.asset,
            challenge: lotUnbound.challenge,
            mayAnswerOpen: lotUnbound.answers.open,
            consign: lotUnbound.consign,
            custody: custodyPda,
            payer: payer.publicKey,
          }),
          lotUnbound.answers.leave,
          lotUnbound.answers.open,
        ),
        Buffer.concat([
          Buffer.from([FP_IX.OpenDirect]),
          lotUnbound.tokenId,
          Buffer.alloc(32, 0),
          Buffer.from([0]),
          Buffer.alloc(32, 0),
          encU64(100),
        ]),
      ),
    ),
    [seller, payer],
    ERR.PassportProgramUnbound,
  );

  // 2. Bind once (measure Bind for budget table)
  const [binding] = pda(programId, [SEED.passportBind]);
  const ixBudget: Record<string, IxBudgetRow> = {};
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
    ),
    [authority, payer],
  );

  // 3. Rebind without early-return → AccountAlreadyInitialized (native)
  const rebindCode = await expectAccountAlreadyInitialized(
    conn,
    new Transaction().add(
      bindPassportProgramIx(
        programId,
        configPda,
        authority.publicKey,
        payer.publicKey,
        stack.passportProgram,
        binding,
      ),
    ),
    [authority, payer],
  );

  // 4. Registry miss: bind done, skip AddEncumbranceSource → ModeNotEncumbranceSource(71)
  const lotRegMiss = await mintCoreLot(conn, stack, programId, payer, seller);
  const registryMissCode = await expectCustom(
    conn,
    new Transaction().add(
      ix(
        programId,
        withOpenAnswers(
          openDirectKeys({
            seller: seller.publicKey,
            config: configPda,
            binding,
            passportConfig: stack.passportConfig,
            asset: lotRegMiss.asset,
            challenge: lotRegMiss.challenge,
            mayAnswerOpen: lotRegMiss.answers.open,
            consign: lotRegMiss.consign,
            custody: custodyPda,
            payer: payer.publicKey,
          }),
          lotRegMiss.answers.leave,
          lotRegMiss.answers.open,
        ),
        Buffer.concat([
          Buffer.from([FP_IX.OpenDirect]),
          lotRegMiss.tokenId,
          Buffer.alloc(32, 0),
          Buffer.from([0]),
          Buffer.alloc(32, 0),
          encU64(100),
        ]),
      ),
    ),
    [seller, payer],
    ERR.ModeNotEncumbranceSource,
  );

  await addEncumbranceSource(conn, stack, programId, ENCUMBRANCE_SEED_PREFIX);

  // 5. Frozen open via real gateway.Send: mint + Send → custody lock +
  // PermanentFreeze; OpenDirect as seller → NotPassportOwner(79) (owner moved to gateway).
  const lotFrozen = await mintCoreLot(conn, stack, programId, payer, seller);
  const [frozenState] = pda(stack.passportProgram, [SEED.state, lotFrozen.tokenId]);
  const sendFrozen = await tryGatewaySend(conn, stack, seller, payer, {
    tokenId: lotFrozen.tokenId,
    asset: lotFrozen.asset,
    state: frozenState,
    challenge: lotFrozen.challenge,
    mayAnswers: [lotFrozen.answers.leave],
  });
  assert.equal(sendFrozen, null, "gateway.Send must succeed before open refuse");
  const frozenStateInfo = await conn.getAccountInfo(frozenState);
  assert.ok(frozenStateInfo, "state after Send");
  const frozenCustodyLocked = passportStateCustodyLocked(
    frozenStateInfo!.data as Buffer,
  );
  assert.equal(frozenCustodyLocked, true, "custody_locked after Send");
  const frozenAssetInfo = await conn.getAccountInfo(lotFrozen.asset);
  assert.ok(frozenAssetInfo, "asset after Send");
  const frozenPermanentFreeze = isPermanentlyFrozen(frozenAssetInfo!.data as Buffer);
  assert.equal(frozenPermanentFreeze, true, "PermanentFreeze frozen after Send");
  const frozenOpenCode = await expectCustom(
    conn,
    new Transaction().add(
      ix(
        programId,
        withOpenAnswers(
          openDirectKeys({
            seller: seller.publicKey,
            config: configPda,
            binding,
            passportConfig: stack.passportConfig,
            asset: lotFrozen.asset,
            challenge: lotFrozen.challenge,
            mayAnswerOpen: lotFrozen.answers.open,
            consign: lotFrozen.consign,
            custody: custodyPda,
            payer: payer.publicKey,
          }),
          lotFrozen.answers.leave,
          lotFrozen.answers.open,
        ),
        Buffer.concat([
          Buffer.from([FP_IX.OpenDirect]),
          lotFrozen.tokenId,
          Buffer.alloc(32, 0),
          Buffer.from([0]),
          Buffer.alloc(32, 0),
          encU64(100),
        ]),
      ),
    ),
    [seller, payer],
    ERR.NotPassportOwner,
  );

  // 6. Retired harness ix CreateAsset → HarnessInstructionRetired(141)
  const retiredIxCode = await expectCustom(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        Buffer.concat([Buffer.from([FP_IX.CreateAsset]), Buffer.alloc(32, 0xee)]),
      ),
    ),
    [payer],
    ERR.HarnessInstructionRetired,
  );

  const ctx = {
    programId,
    configPda,
    binding,
    stack,
    custodyPda,
    payer,
    seller,
  };

  // ---- Native buy + gateway.Send LeaveChain while live / after close ----
  const lotN = await mintCoreLot(conn, stack, programId, payer, seller);
  const priceN = 1000n;
  await openDirectNative(conn, ctx, lotN, priceN);
  const [lotNState] = pda(stack.passportProgram, [SEED.state, lotN.tokenId]);

  const leaveChainSendWhileLive = await tryGatewaySend(conn, stack, seller, payer, {
    tokenId: lotN.tokenId,
    asset: lotN.asset,
    state: lotNState,
    challenge: lotN.challenge,
    mayAnswers: [lotN.answers.leave],
  });
  assert.equal(leaveChainSendWhileLive, ERR.LeaveChainRefused);
  const leaveChainWhileLive = leaveChainSendWhileLive;

  const lotNData = readConsignment((await conn.getAccountInfo(lotN.consign))!.data as Buffer);
  assert.equal(lotNData.phase, PHASE.Offered);
  const platformAmt = (priceN * BigInt(lotNData.feeBps)) / 10_000n;
  const sellerAmt = priceN - platformAmt;
  const agentAmt = 0n;

  const balP0 = BigInt(await conn.getBalance(platform.publicKey));
  const balS0 = BigInt(await conn.getBalance(seller.publicKey));
  const balA0 = BigInt(await conn.getBalance(agent.publicKey));

  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        buyHeadKeys({
          buyer: buyer.publicKey,
          config: configPda,
          consign: lotN.consign,
          binding,
          passportConfig: stack.passportConfig,
          asset: lotN.asset,
          custody: custodyPda,
          platform: platform.publicKey,
          seller: seller.publicKey,
          agent: agent.publicKey,
          recall: lotN.recall,
          payer: payer.publicKey,
          escrow: lotN.escrow,
          answerLeave: lotN.answers.leave,
          answerOpen: lotN.answers.open,
        }),
        Buffer.concat([Buffer.from([FP_IX.Buy]), lotN.tokenId]),
      ),
    ),
    [buyer, payer],
  );

  const closedN = readConsignment((await conn.getAccountInfo(lotN.consign))!.data as Buffer);
  const buyerOwnsN = coreOwner((await conn.getAccountInfo(lotN.asset))!.data as Buffer).toBase58();
  assert.equal(closedN.phase, PHASE.Closed);
  assert.equal(buyerOwnsN, buyer.publicKey.toBase58());
  const balP1 = BigInt(await conn.getBalance(platform.publicKey));
  const balS1 = BigInt(await conn.getBalance(seller.publicKey));
  const balA1 = BigInt(await conn.getBalance(agent.publicKey));
  assert.equal(balP1 - balP0, platformAmt);
  assert.equal(balS1 - balS0, sellerAmt);
  assert.equal(balA1 - balA0, agentAmt);

  // After close answers allow LeaveChain; buyer owns Core → Send succeeds (lock + freeze).
  const leaveChainSendAfterClose = await tryGatewaySend(conn, stack, buyer, payer, {
    tokenId: lotN.tokenId,
    asset: lotN.asset,
    state: lotNState,
    challenge: lotN.challenge,
    mayAnswers: [lotN.answers.leave],
  });
  assert.equal(leaveChainSendAfterClose, null);
  const leaveChainAfterClose = leaveChainSendAfterClose;
  assert.equal(
    passportStateCustodyLocked((await conn.getAccountInfo(lotNState))!.data as Buffer),
    true,
    "custody_locked after post-close Send",
  );

  // ---- Fiat native refuse ----
  const lotF = await mintCoreLot(conn, stack, programId, payer, seller);
  const fiatRefuseCode = await expectCustom(
    conn,
    new Transaction().add(
      ix(
        programId,
        withOpenAnswers(
          openDirectKeys({
            seller: seller.publicKey,
            config: configPda,
            binding,
            passportConfig: stack.passportConfig,
            asset: lotF.asset,
            challenge: lotF.challenge,
            mayAnswerOpen: lotF.answers.open,
            consign: lotF.consign,
            custody: custodyPda,
            payer: payer.publicKey,
          }),
          lotF.answers.leave,
          lotF.answers.open,
        ),
        Buffer.concat([
          Buffer.from([FP_IX.OpenDirect]),
          lotF.tokenId,
          Buffer.alloc(32, 0),
          Buffer.from([1]),
          CURRENCY_USD,
          encU64(500),
        ]),
      ),
    ),
    [seller, payer],
    ERR.CurrencyNotAvailableOnChain,
  );

  // ---- External confirm ----
  const lotE = await mintCoreLot(conn, stack, programId, payer, seller);
  const [noteE] = pda(programId, [SEED.settlementNote, lotE.tokenId]);
  await openDirectNative(conn, ctx, lotE, 777n);

  const noteBytes = Buffer.alloc(256);
  Buffer.from("paid offline").copy(noteBytes);
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: seller.publicKey, isSigner: true, isWritable: false },
          { pubkey: lotE.consign, isSigner: false, isWritable: false },
          { pubkey: noteE, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        ],
        Buffer.concat([
          Buffer.from([FP_IX.SetSettlementNote]),
          lotE.tokenId,
          noteBytes,
          encU32(12),
        ]),
      ),
    ),
    [seller, payer],
  );

  const extP0 = BigInt(await conn.getBalance(platform.publicKey));
  const extS0 = BigInt(await conn.getBalance(seller.publicKey));
  const extEsc0 = BigInt((await conn.getAccountInfo(lotE.escrow))?.lamports ?? 0);

  {
    const tx = new Transaction().add(
      ix(
        programId,
        confirmExternalKeys({
          caller: seller.publicKey,
          consign: lotE.consign,
          note: noteE,
          recall: lotE.recall,
          binding,
          passportConfig: stack.passportConfig,
          asset: lotE.asset,
          custody: custodyPda,
          buyer: buyer.publicKey,
          payer: payer.publicKey,
          answerLeave: lotE.answers.leave,
          answerOpen: lotE.answers.open,
        }),
        Buffer.concat([
          Buffer.from([FP_IX.ConfirmExternalPayment]),
          lotE.tokenId,
          buyer.publicKey.toBuffer(),
        ]),
      ),
    );
    tx.feePayer = payer.publicKey;
    await sendAndConfirmTransaction(conn, tx, [payer, seller]);
  }

  const closedE = readConsignment((await conn.getAccountInfo(lotE.consign))!.data as Buffer);
  const extBuyerOwns = coreOwner((await conn.getAccountInfo(lotE.asset))!.data as Buffer).toBase58();
  assert.equal(closedE.phase, PHASE.Closed);
  assert.equal(extBuyerOwns, buyer.publicKey.toBase58());
  const extP1 = BigInt(await conn.getBalance(platform.publicKey));
  const extS1 = BigInt(await conn.getBalance(seller.publicKey));
  const extEsc1 = BigInt((await conn.getAccountInfo(lotE.escrow))?.lamports ?? 0);
  assert.equal(extP1 - extP0, 0n);
  assert.equal(extS1 - extS0, 0n);
  assert.equal(extEsc1 - extEsc0, 0n);

  // ---- Pause ----
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: guardian.publicKey, isSigner: true, isWritable: false },
          { pubkey: configPda, isSigner: false, isWritable: true },
        ],
        Buffer.from([FP_IX.Pause]),
      ),
    ),
    [guardian],
  );

  const lotP = await mintCoreLot(conn, stack, programId, payer, seller);
  const pauseOpenCode = await expectCustom(
    conn,
    new Transaction().add(
      ix(
        programId,
        withOpenAnswers(
          openDirectKeys({
            seller: seller.publicKey,
            config: configPda,
            binding,
            passportConfig: stack.passportConfig,
            asset: lotP.asset,
            challenge: lotP.challenge,
            mayAnswerOpen: lotP.answers.open,
            consign: lotP.consign,
            custody: custodyPda,
            payer: payer.publicKey,
          }),
          lotP.answers.leave,
          lotP.answers.open,
        ),
        Buffer.concat([
          Buffer.from([FP_IX.OpenDirect]),
          lotP.tokenId,
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

  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: authority.publicKey, isSigner: true, isWritable: false },
          { pubkey: configPda, isSigner: false, isWritable: true },
        ],
        Buffer.from([FP_IX.Unpause]),
      ),
    ),
    [authority],
  );

  const lotPb = await mintCoreLot(conn, stack, programId, payer, seller);
  const [notePb] = pda(programId, [SEED.settlementNote, lotPb.tokenId]);
  await openDirectNative(conn, ctx, lotPb, 200n);

  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: guardian.publicKey, isSigner: true, isWritable: false },
          { pubkey: configPda, isSigner: false, isWritable: true },
        ],
        Buffer.from([FP_IX.Pause]),
      ),
    ),
    [guardian],
  );

  const pauseBuyCode = await expectCustom(
    conn,
    new Transaction().add(
      ix(
        programId,
        buyHeadKeys({
          buyer: buyer.publicKey,
          config: configPda,
          consign: lotPb.consign,
          binding,
          passportConfig: stack.passportConfig,
          asset: lotPb.asset,
          custody: custodyPda,
          platform: platform.publicKey,
          seller: seller.publicKey,
          agent: agent.publicKey,
          recall: lotPb.recall,
          payer: payer.publicKey,
          escrow: lotPb.escrow,
          answerLeave: lotPb.answers.leave,
          answerOpen: lotPb.answers.open,
        }),
        Buffer.concat([Buffer.from([FP_IX.Buy]), lotPb.tokenId]),
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
          { pubkey: lotPb.consign, isSigner: false, isWritable: false },
          { pubkey: notePb, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        ],
        Buffer.concat([
          Buffer.from([FP_IX.SetSettlementNote]),
          lotPb.tokenId,
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
        confirmExternalKeys({
          caller: seller.publicKey,
          consign: lotPb.consign,
          note: notePb,
          recall: lotPb.recall,
          binding,
          passportConfig: stack.passportConfig,
          asset: lotPb.asset,
          custody: custodyPda,
          buyer: buyer.publicKey,
          payer: payer.publicKey,
          answerLeave: lotPb.answers.leave,
          answerOpen: lotPb.answers.open,
        }),
        Buffer.concat([
          Buffer.from([FP_IX.ConfirmExternalPayment]),
          lotPb.tokenId,
          buyer.publicKey.toBuffer(),
        ]),
      ),
    ),
    [seller, payer],
  );
  const pauseExternalPhase = readConsignment(
    (await conn.getAccountInfo(lotPb.consign))!.data as Buffer,
  ).phase;
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
        Buffer.from([FP_IX.Unpause]),
      ),
    ),
    [authority],
  );

  // ---- SPL soft-revoke buy ----
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
        encApproveAssetOnly(),
      ),
    ),
    [authority, payer],
  );

  const payTokInfo = await conn.getAccountInfo(payTok);
  assert.ok(payTokInfo);
  const admittedDecimals = payTokInfo.data[8 + 32 + 1]!;
  const mintInfo = await conn.getAccountInfo(mint.publicKey);
  assert.ok(mintInfo);
  const chainMintDecimals = mintInfo.data[44]!;
  assert.equal(admittedDecimals, chainMintDecimals);
  assert.equal(admittedDecimals, 6);

  const lotS = await mintCoreLot(conn, stack, programId, payer, seller);
  const priceS = 1000n;
  await openDirectSpl(
    conn,
    ctx,
    lotS,
    mint.publicKey,
    payTok,
    0,
    Buffer.alloc(32, 0),
    priceS,
  );

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
        Buffer.concat([Buffer.from([FP_IX.RevokePaymentToken]), mint.publicKey.toBuffer()]),
      ),
    ),
    [guardian],
  );

  const ataRent = await getMinimumBalanceForRentExemptAccount(conn);
  const buyerAta = Keypair.generate();
  const escrowAta = Keypair.generate();
  const platformAta = Keypair.generate();
  const sellerAta = Keypair.generate();
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
      createInitializeAccount3Instruction(escrowAta.publicKey, mint.publicKey, lotS.escrow),
      createMintToInstruction(mint.publicKey, buyerAta.publicKey, payer.publicKey, Number(priceS)),
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
    [payer, buyerAta, escrowAta, platformAta, sellerAta],
  );

  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          ...buyHeadKeys({
            buyer: buyer.publicKey,
            config: configPda,
            consign: lotS.consign,
            binding,
            passportConfig: stack.passportConfig,
            asset: lotS.asset,
            custody: custodyPda,
            platform: platform.publicKey,
            seller: seller.publicKey,
            agent: agent.publicKey,
            recall: lotS.recall,
            payer: payer.publicKey,
            escrow: lotS.escrow,
            answerLeave: lotS.answers.leave,
            answerOpen: lotS.answers.open,
          }),
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
        Buffer.concat([Buffer.from([FP_IX.Buy]), lotS.tokenId]),
      ),
    ),
    [buyer, payer],
  );

  const softRevokeBuyPhase = readConsignment(
    (await conn.getAccountInfo(lotS.consign))!.data as Buffer,
  ).phase;
  assert.equal(softRevokeBuyPhase, PHASE.Closed);
  const platTok = await getAccount(conn, platformAta.publicKey);
  const sellTok = await getAccount(conn, sellerAta.publicKey);
  const splBuySettledTotal = platTok.amount + sellTok.amount;
  assert.equal(splBuySettledTotal, priceS);

  // ---- Transfer-fee mint refused ----
  const extensions = [ExtensionType.TransferFeeConfig];
  const mintLen = getMintLen(extensions);
  const feeMint = Keypair.generate();
  const feeMintRent = await conn.getMinimumBalanceForRentExemption(mintLen);
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
        100,
        BigInt(1e12),
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

  const [payTokFee] = pda(programId, [SEED.paymentToken, feeMint.publicKey.toBuffer()]);
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

  // ---- Fiat SPL no feed ----
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
  const [payTokNoFeed] = pda(programId, [SEED.paymentToken, mintNoFeed.publicKey.toBuffer()]);
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
  const lotNoFeed = await mintCoreLot(conn, stack, programId, payer, seller);
  const fiatNoFeedCode = await expectCustom(
    conn,
    new Transaction().add(
      ix(
        programId,
        withOpenAnswers(
          openDirectKeys({
            seller: seller.publicKey,
            config: configPda,
            paymentTok: payTokNoFeed,
            binding,
            passportConfig: stack.passportConfig,
            asset: lotNoFeed.asset,
            challenge: lotNoFeed.challenge,
            mayAnswerOpen: lotNoFeed.answers.open,
            consign: lotNoFeed.consign,
            custody: custodyPda,
            payer: payer.publicKey,
          }),
          lotNoFeed.answers.leave,
          lotNoFeed.answers.open,
        ),
        Buffer.concat([
          Buffer.from([FP_IX.OpenDirect]),
          lotNoFeed.tokenId,
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

  // ---- Fiat SPL with lab price ----
  const mintFiat = Keypair.generate();
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mintFiat.publicKey,
        space: 82,
        lamports: await getMinimumBalanceForRentExemptMint(conn),
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(mintFiat.publicKey, 6, payer.publicKey, null),
    ),
    [payer, mintFiat],
  );
  const [payTokFiat] = pda(programId, [SEED.paymentToken, mintFiat.publicKey.toBuffer()]);
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

  const [priceLabPda] = pda(programId, [SEED.priceLab, LAB_FEED_ID]);
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
          Buffer.concat([Buffer.from([FP_IX.ForceSeedPriceAccount]), LAB_FEED_ID, data]),
        ),
      ),
      [authority, payer],
    );
  }

  async function fiatRefuseBuy(
    fixture: string,
    publishUnix: number,
    errCode: number,
  ): Promise<number> {
    await seedPrice(fixture, publishUnix);
    const lot = await mintCoreLot(conn, stack, programId, payer, seller);
    await openDirectSpl(
      conn,
      ctx,
      lot,
      mintFiat.publicKey,
      payTokFiat,
      DENOM_FIAT,
      CURRENCY_USD,
      150_0000_0000n,
    );
    const bAta = Keypair.generate();
    const eAta = Keypair.generate();
    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: payer.publicKey,
          newAccountPubkey: bAta.publicKey,
          space: 165,
          lamports: ataRent,
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeAccount3Instruction(bAta.publicKey, mintFiat.publicKey, buyer.publicKey),
        SystemProgram.createAccount({
          fromPubkey: payer.publicKey,
          newAccountPubkey: eAta.publicKey,
          space: 165,
          lamports: ataRent,
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeAccount3Instruction(eAta.publicKey, mintFiat.publicKey, lot.escrow),
        createMintToInstruction(mintFiat.publicKey, bAta.publicKey, payer.publicKey, 2_000_000),
      ),
      [payer, bAta, eAta],
    );
    return expectCustom(
      conn,
      new Transaction().add(
        ix(
          programId,
          [
            ...buyHeadKeys({
              buyer: buyer.publicKey,
              config: configPda,
              consign: lot.consign,
              binding,
              passportConfig: stack.passportConfig,
              asset: lot.asset,
              custody: custodyPda,
              platform: platform.publicKey,
              seller: seller.publicKey,
              agent: seller.publicKey,
              recall: lot.recall,
              payer: payer.publicKey,
              escrow: lot.escrow,
              answerLeave: lot.answers.leave,
              answerOpen: lot.answers.open,
            }),
            { pubkey: payTokFiat, isSigner: false, isWritable: false },
            { pubkey: priceLabPda, isSigner: false, isWritable: false },
            { pubkey: bAta.publicKey, isSigner: false, isWritable: true },
            { pubkey: eAta.publicKey, isSigner: false, isWritable: true },
            { pubkey: mintFiat.publicKey, isSigner: false, isWritable: false },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          ],
          Buffer.concat([Buffer.from([FP_IX.Buy]), lot.tokenId]),
        ),
      ),
      [buyer, payer],
      errCode,
    );
  }

  const staleBuyCode = await fiatRefuseBuy("lab-stale.bin", nowUnix - 1_000_000, ERR.StalePrice);
  const wideConfCode = await fiatRefuseBuy("lab-wide_conf.bin", nowUnix, ERR.ConfidenceTooWide);
  const badOracleCode = await fiatRefuseBuy("lab-non_positive.bin", nowUnix, ERR.BadOracleAnswer);

  // Fresh fiat settle
  await seedPrice("lab-fresh_narrow.bin", nowUnix);
  const lotFresh = await mintCoreLot(conn, stack, programId, payer, seller);
  const fiatPrice1e8 = 150_0000_0000n;
  const expectedAssetAmt = 1_000_000n;
  await openDirectSpl(
    conn,
    ctx,
    lotFresh,
    mintFiat.publicKey,
    payTokFiat,
    DENOM_FIAT,
    CURRENCY_USD,
    fiatPrice1e8,
  );
  const buyerAtaFresh = Keypair.generate();
  const escrowAtaFresh = Keypair.generate();
  const platformAtaF = Keypair.generate();
  const sellerAtaF = Keypair.generate();
  const [platClaimF] = pda(programId, [
    SEED.claim,
    platform.publicKey.toBuffer(),
    mintFiat.publicKey.toBuffer(),
  ]);
  const [platClaimAtaF] = pda(programId, [
    SEED.claimAta,
    platform.publicKey.toBuffer(),
    mintFiat.publicKey.toBuffer(),
  ]);
  const [sellClaimF] = pda(programId, [
    SEED.claim,
    seller.publicKey.toBuffer(),
    mintFiat.publicKey.toBuffer(),
  ]);
  const [sellClaimAtaF] = pda(programId, [
    SEED.claimAta,
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
      createInitializeAccount3Instruction(
        escrowAtaFresh.publicKey,
        mintFiat.publicKey,
        lotFresh.escrow,
      ),
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
          ...buyHeadKeys({
            buyer: buyer.publicKey,
            config: configPda,
            consign: lotFresh.consign,
            binding,
            passportConfig: stack.passportConfig,
            asset: lotFresh.asset,
            custody: custodyPda,
            platform: platform.publicKey,
            seller: seller.publicKey,
            agent: seller.publicKey,
            recall: lotFresh.recall,
            payer: payer.publicKey,
            escrow: lotFresh.escrow,
            answerLeave: lotFresh.answers.leave,
            answerOpen: lotFresh.answers.open,
          }),
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
        Buffer.concat([Buffer.from([FP_IX.Buy]), lotFresh.tokenId]),
      ),
    ),
    [buyer, payer],
  );
  const freshClosed = readConsignment((await conn.getAccountInfo(lotFresh.consign))!.data as Buffer);
  const freshOwner = coreOwner((await conn.getAccountInfo(lotFresh.asset))!.data as Buffer);
  assert.equal(freshClosed.phase, PHASE.Closed);
  assert.equal(freshOwner.toBase58(), buyer.publicKey.toBase58());

  // ---- Agented Margin fiat + Revoke / TransferDelegate pin ----
  await seedPrice("lab-fresh_narrow.bin", nowUnix);
  const lotAg = await mintCoreLot(conn, stack, programId, payer, seller);
  await addTransferDelegateToCustody(conn, seller, payer, lotAg.asset, custodyPda);
  assert.ok(
    hasTransferDelegateAddress(
      (await conn.getAccountInfo(lotAg.asset))!.data as Buffer,
      custodyPda,
    ),
  );

  const [mandateAg] = pda(programId, [SEED.mandate, lotAg.tokenId]);
  const fiatFloor1e8 = 100_0000_0000n;
  const fiatAgentedPrice = fiatPrice1e8;
  const feeBpsAg = 250n;
  const amountAg = expectedAssetAmt;
  const baseFiat = fiatAgentedPrice - (fiatAgentedPrice * feeBpsAg) / 10_000n;
  const baseAsset = amountAg - (amountAg * feeBpsAg) / 10_000n;
  const expectedFloorAsset = (baseAsset * fiatFloor1e8) / baseFiat;

  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        grantKeys({
          owner: seller.publicKey,
          binding,
          asset: lotAg.asset,
          mandate: mandateAg,
          consign: lotAg.consign,
          custody: custodyPda,
          payer: payer.publicKey,
        }),
        Buffer.concat([
          Buffer.from([FP_IX.Grant]),
          lotAg.tokenId,
          agent.publicKey.toBuffer(),
          encU64(0),
          mintFiat.publicKey.toBuffer(),
          Buffer.from([DENOM_FIAT]),
          CURRENCY_USD,
          encU64(fiatFloor1e8),
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
          mandate: mandateAg,
          paymentTok: payTokFiat,
          binding,
          passportConfig: stack.passportConfig,
          asset: lotAg.asset,
          challenge: lotAg.challenge,
          mayAnswerOpen: lotAg.answers.open,
          consign: lotAg.consign,
          custody: custodyPda,
          payer: payer.publicKey,
          answerLeave: lotAg.answers.leave,
          answerOpen: lotAg.answers.open,
        }),
        Buffer.concat([
          Buffer.from([FP_IX.OpenFromMandate]),
          lotAg.tokenId,
          Buffer.from([DENOM_FIAT]),
          CURRENCY_USD,
          encU64(fiatAgentedPrice),
        ]),
      ),
    ),
    [agent, payer],
  );

  const lotAgBefore = readConsignment((await conn.getAccountInfo(lotAg.consign))!.data as Buffer);
  assert.equal(lotAgBefore.phase, PHASE.Offered);
  assert.equal(lotAgBefore.floor, fiatFloor1e8);
  const floorBefore = lotAgBefore.floor;

  const buyerAtaAg = Keypair.generate();
  const escrowAtaAg = Keypair.generate();
  const platformAtaAg = Keypair.generate();
  const sellerAtaAg = Keypair.generate();
  const agentAtaAg = Keypair.generate();
  const [platClaimAg] = pda(programId, [
    SEED.claim,
    platform.publicKey.toBuffer(),
    mintFiat.publicKey.toBuffer(),
  ]);
  const [platClaimAtaAg] = pda(programId, [
    SEED.claimAta,
    platform.publicKey.toBuffer(),
    mintFiat.publicKey.toBuffer(),
  ]);
  const [sellClaimAg] = pda(programId, [
    SEED.claim,
    seller.publicKey.toBuffer(),
    mintFiat.publicKey.toBuffer(),
  ]);
  const [sellClaimAtaAg] = pda(programId, [
    SEED.claimAta,
    seller.publicKey.toBuffer(),
    mintFiat.publicKey.toBuffer(),
  ]);
  const [agentClaimAg] = pda(programId, [
    SEED.claim,
    agent.publicKey.toBuffer(),
    mintFiat.publicKey.toBuffer(),
  ]);
  const [agentClaimAtaAg] = pda(programId, [
    SEED.claimAta,
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
      createInitializeAccount3Instruction(buyerAtaAg.publicKey, mintFiat.publicKey, buyer.publicKey),
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: escrowAtaAg.publicKey,
        space: 165,
        lamports: ataRent,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeAccount3Instruction(escrowAtaAg.publicKey, mintFiat.publicKey, lotAg.escrow),
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

  const platBeforeAg = (await getAccount(conn, platformAtaAg.publicKey)).amount;
  const sellBeforeAg = (await getAccount(conn, sellerAtaAg.publicKey)).amount;
  const agentBeforeAg = (await getAccount(conn, agentAtaAg.publicKey)).amount;

  const agentedBuyIx = ix(
    programId,
    [
      ...buyHeadKeys({
        buyer: buyer.publicKey,
        config: configPda,
        consign: lotAg.consign,
        binding,
        passportConfig: stack.passportConfig,
        asset: lotAg.asset,
        custody: custodyPda,
        platform: platform.publicKey,
        seller: seller.publicKey,
        agent: agent.publicKey,
        recall: lotAg.recall,
        payer: payer.publicKey,
        escrow: lotAg.escrow,
        answerLeave: lotAg.answers.leave,
        answerOpen: lotAg.answers.open,
      }),
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
    Buffer.concat([Buffer.from([FP_IX.Buy]), lotAg.tokenId]),
  );
  const agentedBuyAlt = await sendIxWithAlt(conn, payer, agentedBuyIx, [buyer, payer]);
  console.warn(
    `[svm-stand] fixed-price agented buy ALT legacyWouldBe=${agentedBuyAlt.legacyWouldBe} ` +
      `versionedSize=${agentedBuyAlt.versionedSize} (limit 1232)`,
  );

  const lotAgAfter = readConsignment((await conn.getAccountInfo(lotAg.consign))!.data as Buffer);
  assert.equal(lotAgAfter.phase, PHASE.Closed);
  // Sold clears durable floor; D-27 rewrite is proven by Margin owner leg === expectedFloorAsset.
  assert.equal(lotAgAfter.floor, 0n);
  const platformDeltaAg =
    (await getAccount(conn, platformAtaAg.publicKey)).amount - platBeforeAg;
  const ownerDeltaAg = (await getAccount(conn, sellerAtaAg.publicKey)).amount - sellBeforeAg;
  const agentDeltaAg = (await getAccount(conn, agentAtaAg.publicKey)).amount - agentBeforeAg;
  const expectedPlatformAg = (amountAg * feeBpsAg) / 10_000n;
  assert.equal(ownerDeltaAg, expectedFloorAsset, "D-27 Margin owner = rewritten floor");
  assert.equal(platformDeltaAg, expectedPlatformAg);
  assert.equal(platformDeltaAg + ownerDeltaAg + agentDeltaAg, amountAg);

  // Revoke leaves TransferDelegate; OpenFromMandate → NoMandate
  const lotRev = await mintCoreLot(conn, stack, programId, payer, seller);
  await addTransferDelegateToCustody(conn, seller, payer, lotRev.asset, custodyPda);
  const [mandateRev] = pda(programId, [SEED.mandate, lotRev.tokenId]);
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        grantKeys({
          owner: seller.publicKey,
          binding,
          asset: lotRev.asset,
          mandate: mandateRev,
          consign: lotRev.consign,
          custody: custodyPda,
          payer: payer.publicKey,
        }),
        Buffer.concat([
          Buffer.from([FP_IX.Grant]),
          lotRev.tokenId,
          agent.publicKey.toBuffer(),
          encU64(0),
          Buffer.alloc(32, 0),
          Buffer.from([0]),
          Buffer.alloc(32, 0),
          encU64(100),
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
          { pubkey: seller.publicKey, isSigner: true, isWritable: false },
          { pubkey: binding, isSigner: false, isWritable: false },
          { pubkey: lotRev.asset, isSigner: false, isWritable: false },
          { pubkey: mandateRev, isSigner: false, isWritable: true },
          { pubkey: lotRev.consign, isSigner: false, isWritable: false },
        ],
        Buffer.concat([Buffer.from([FP_IX.Revoke]), lotRev.tokenId]),
      ),
    ),
    [seller],
  );
  const transferDelegateAfterRevoke = hasTransferDelegateAddress(
    (await conn.getAccountInfo(lotRev.asset))!.data as Buffer,
    custodyPda,
  );
  assert.equal(transferDelegateAfterRevoke, true);
  const revokeOpenCode = await expectCustom(
    conn,
    new Transaction().add(
      ix(
        programId,
        openFromMandateKeys({
          agent: agent.publicKey,
          config: configPda,
          mandate: mandateRev,
          binding,
          passportConfig: stack.passportConfig,
          asset: lotRev.asset,
          challenge: lotRev.challenge,
          mayAnswerOpen: lotRev.answers.open,
          consign: lotRev.consign,
          custody: custodyPda,
          payer: payer.publicKey,
          answerLeave: lotRev.answers.leave,
          answerOpen: lotRev.answers.open,
        }),
        Buffer.concat([
          Buffer.from([FP_IX.OpenFromMandate]),
          lotRev.tokenId,
          Buffer.from([0]),
          Buffer.alloc(32, 0),
          encU64(200),
        ]),
      ),
    ),
    [agent, payer],
    ERR.NoMandate,
  );

  // ---- Per-ix budget table (registry N=1; Bind already measured) ----
  // Re-fund after heavy earlier paths (opens used seller as default fee payer).
  for (const k of [authority, guardian, platform, seller, agent, buyer, payer]) {
    await airdrop(conn, k, 4);
  }
  function grantData(
    tokenId: Buffer,
    floor: bigint,
    form: number,
    commissionBps: number,
    mintPk?: Pk,
    denomKind = DENOM_ASSET,
    currency = Buffer.alloc(32, 0),
  ): Buffer {
    return Buffer.concat([
      Buffer.from([FP_IX.Grant]),
      tokenId,
      agent.publicKey.toBuffer(),
      encU64(0),
      mintPk ? mintPk.toBuffer() : Buffer.alloc(32, 0),
      Buffer.from([denomKind]),
      currency,
      encU64(floor),
      Buffer.from([form]),
      encU16(commissionBps),
    ]);
  }

  // Direct: OpenDirect → SetPrice → OwnerWithdraw
  {
    const lot = await mintCoreLot(conn, stack, programId, payer, seller);
    ixBudget.OpenDirect = await sendAndMeasure(
      conn,
      payer,
      ix(
        programId,
        withOpenAnswers(
          openDirectKeys({
            seller: seller.publicKey,
            config: configPda,
            binding,
            passportConfig: stack.passportConfig,
            asset: lot.asset,
            challenge: lot.challenge,
            mayAnswerOpen: lot.answers.open,
            consign: lot.consign,
            custody: custodyPda,
            payer: payer.publicKey,
          }),
          lot.answers.leave,
          lot.answers.open,
        ),
        Buffer.concat([
          Buffer.from([FP_IX.OpenDirect]),
          lot.tokenId,
          Buffer.alloc(32, 0),
          Buffer.from([0]),
          Buffer.alloc(32, 0),
          encU64(1_000),
        ]),
      ),
      [seller, payer],
    );
    ixBudget.SetPrice = await sendAndMeasure(
      conn,
      payer,
      ix(
        programId,
        [
          { pubkey: seller.publicKey, isSigner: true, isWritable: false },
          { pubkey: lot.consign, isSigner: false, isWritable: true },
        ],
        Buffer.concat([Buffer.from([FP_IX.SetPrice]), lot.tokenId, encU64(1_100)]),
      ),
      [seller],
    );
    ixBudget.OwnerWithdraw = await sendAndMeasure(
      conn,
      payer,
      ix(
        programId,
        terminateKeys({
          caller: seller.publicKey,
          consign: lot.consign,
          recall: lot.recall,
          binding,
          passportConfig: stack.passportConfig,
          asset: lot.asset,
          custody: custodyPda,
          recipient: seller.publicKey,
          payer: payer.publicKey,
          answerLeave: lot.answers.leave,
          answerOpen: lot.answers.open,
        }),
        Buffer.concat([Buffer.from([FP_IX.OwnerWithdraw]), lot.tokenId]),
      ),
      [seller, payer],
    );
  }

  // Grant + Revoke (no open)
  {
    const lot = await mintCoreLot(conn, stack, programId, payer, seller);
    await addTransferDelegateToCustody(conn, seller, payer, lot.asset, custodyPda);
    const [mandate] = pda(programId, [SEED.mandate, lot.tokenId]);
    ixBudget.Grant = await sendAndMeasure(
      conn,
      payer,
      ix(
        programId,
        grantKeys({
          owner: seller.publicKey,
          binding,
          asset: lot.asset,
          mandate,
          consign: lot.consign,
          custody: custodyPda,
          payer: payer.publicKey,
        }),
        grantData(lot.tokenId, 700n, FORM_MARGIN, 0),
      ),
      [seller, payer],
    );
    ixBudget.Revoke = await sendAndMeasure(
      conn,
      payer,
      ix(
        programId,
        [
          { pubkey: seller.publicKey, isSigner: true, isWritable: false },
          { pubkey: binding, isSigner: false, isWritable: false },
          { pubkey: lot.asset, isSigner: false, isWritable: false },
          { pubkey: mandate, isSigner: false, isWritable: true },
          { pubkey: lot.consign, isSigner: false, isWritable: false },
        ],
        Buffer.concat([Buffer.from([FP_IX.Revoke]), lot.tokenId]),
      ),
      [seller],
    );
  }

  // Agented Margin: OpenFromMandate → LowerFloor → AgentWithdraw
  {
    const lot = await mintCoreLot(conn, stack, programId, payer, seller);
    await addTransferDelegateToCustody(conn, seller, payer, lot.asset, custodyPda);
    const [mandate] = pda(programId, [SEED.mandate, lot.tokenId]);
    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        ix(
          programId,
          grantKeys({
            owner: seller.publicKey,
            binding,
            asset: lot.asset,
            mandate,
            consign: lot.consign,
            custody: custodyPda,
            payer: payer.publicKey,
          }),
          grantData(lot.tokenId, 700n, FORM_MARGIN, 0),
        ),
      ),
      [seller, payer],
    );
    ixBudget.OpenFromMandate = await sendAndMeasure(
      conn,
      payer,
      ix(
        programId,
        openFromMandateKeys({
          agent: agent.publicKey,
          config: configPda,
          mandate,
          binding,
          passportConfig: stack.passportConfig,
          asset: lot.asset,
          challenge: lot.challenge,
          mayAnswerOpen: lot.answers.open,
          consign: lot.consign,
          custody: custodyPda,
          payer: payer.publicKey,
          answerLeave: lot.answers.leave,
          answerOpen: lot.answers.open,
        }),
        Buffer.concat([
          Buffer.from([FP_IX.OpenFromMandate]),
          lot.tokenId,
          Buffer.from([0]),
          Buffer.alloc(32, 0),
          encU64(1_000),
        ]),
      ),
      [agent, payer],
    );
    ixBudget.LowerFloor = await sendAndMeasure(
      conn,
      payer,
      ix(
        programId,
        [
          { pubkey: seller.publicKey, isSigner: true, isWritable: false },
          { pubkey: lot.asset, isSigner: false, isWritable: false },
          { pubkey: lot.consign, isSigner: false, isWritable: true },
        ],
        Buffer.concat([Buffer.from([FP_IX.LowerFloor]), lot.tokenId, encU64(500)]),
      ),
      [seller],
    );
    ixBudget.AgentWithdraw = await sendAndMeasure(
      conn,
      payer,
      ix(
        programId,
        terminateKeys({
          caller: agent.publicKey,
          consign: lot.consign,
          recall: lot.recall,
          binding,
          passportConfig: stack.passportConfig,
          asset: lot.asset,
          custody: custodyPda,
          recipient: seller.publicKey,
          payer: payer.publicKey,
          answerLeave: lot.answers.leave,
          answerOpen: lot.answers.open,
        }),
        Buffer.concat([Buffer.from([FP_IX.AgentWithdraw]), lot.tokenId]),
      ),
      [agent, payer],
    );
  }

  // Agented Commission: LowerCommission → RequestRecall → warp → ForceRecall
  {
    const lot = await mintCoreLot(conn, stack, programId, payer, seller);
    await addTransferDelegateToCustody(conn, seller, payer, lot.asset, custodyPda);
    const [mandate] = pda(programId, [SEED.mandate, lot.tokenId]);
    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        ix(
          programId,
          grantKeys({
            owner: seller.publicKey,
            binding,
            asset: lot.asset,
            mandate,
            consign: lot.consign,
            custody: custodyPda,
            payer: payer.publicKey,
          }),
          grantData(lot.tokenId, 700n, FORM_COMMISSION, 500),
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
            mandate,
            binding,
            passportConfig: stack.passportConfig,
            asset: lot.asset,
            challenge: lot.challenge,
            mayAnswerOpen: lot.answers.open,
            consign: lot.consign,
            custody: custodyPda,
            payer: payer.publicKey,
            answerLeave: lot.answers.leave,
            answerOpen: lot.answers.open,
          }),
          Buffer.concat([
            Buffer.from([FP_IX.OpenFromMandate]),
            lot.tokenId,
            Buffer.from([0]),
            Buffer.alloc(32, 0),
            encU64(1_000),
          ]),
        ),
      ),
      [agent, payer],
    );
    ixBudget.LowerCommission = await sendAndMeasure(
      conn,
      payer,
      ix(
        programId,
        [
          { pubkey: agent.publicKey, isSigner: true, isWritable: false },
          { pubkey: lot.consign, isSigner: false, isWritable: true },
        ],
        Buffer.concat([Buffer.from([FP_IX.LowerCommission]), lot.tokenId, encU16(250)]),
      ),
      [agent],
    );
    ixBudget.RequestRecall = await sendAndMeasure(
      conn,
      payer,
      ix(
        programId,
        [
          { pubkey: seller.publicKey, isSigner: true, isWritable: false },
          { pubkey: lot.consign, isSigner: false, isWritable: false },
          { pubkey: lot.recall, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        ],
        Buffer.concat([Buffer.from([FP_IX.RequestRecall]), lot.tokenId]),
      ),
      [seller, payer],
    );
    const past = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60 - 10;
    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        ix(
          programId,
          [
            { pubkey: authority.publicKey, isSigner: true, isWritable: false },
            { pubkey: configPda, isSigner: false, isWritable: false },
            { pubkey: lot.recall, isSigner: false, isWritable: true },
          ],
          Buffer.concat([
            Buffer.from([FP_IX.ForceRecallRequestedAt]),
            lot.tokenId,
            encU64(past),
          ]),
        ),
      ),
      [authority],
    );
    ixBudget.ForceRecall = await sendAndMeasure(
      conn,
      payer,
      ix(
        programId,
        terminateKeys({
          caller: seller.publicKey,
          consign: lot.consign,
          recall: lot.recall,
          binding,
          passportConfig: stack.passportConfig,
          asset: lot.asset,
          custody: custodyPda,
          recipient: seller.publicKey,
          payer: payer.publicKey,
          answerLeave: lot.answers.leave,
          answerOpen: lot.answers.open,
        }),
        Buffer.concat([Buffer.from([FP_IX.ForceRecall]), lot.tokenId]),
      ),
      [seller, payer],
    );
  }

  // Buy native direct
  {
    const lot = await mintCoreLot(conn, stack, programId, payer, seller);
    await openDirectNative(conn, ctx, lot, 1_000n);
    ixBudget["Buy native direct"] = await sendAndMeasure(
      conn,
      payer,
      ix(
        programId,
        buyHeadKeys({
          buyer: buyer.publicKey,
          config: configPda,
          consign: lot.consign,
          binding,
          passportConfig: stack.passportConfig,
          asset: lot.asset,
          custody: custodyPda,
          platform: platform.publicKey,
          seller: seller.publicKey,
          agent: agent.publicKey,
          recall: lot.recall,
          payer: payer.publicKey,
          escrow: lot.escrow,
          answerLeave: lot.answers.leave,
          answerOpen: lot.answers.open,
        }),
        Buffer.concat([Buffer.from([FP_IX.Buy]), lot.tokenId]),
      ),
      [buyer, payer],
    );
  }

  // Buy SPL direct (fresh asset mint)
  {
    const mintBd = Keypair.generate();
    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: payer.publicKey,
          newAccountPubkey: mintBd.publicKey,
          space: 82,
          lamports: await getMinimumBalanceForRentExemptMint(conn),
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMint2Instruction(mintBd.publicKey, 6, payer.publicKey, null),
      ),
      [payer, mintBd],
    );
    const [payTokBd] = pda(programId, [SEED.paymentToken, mintBd.publicKey.toBuffer()]);
    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        ix(
          programId,
          [
            { pubkey: authority.publicKey, isSigner: true, isWritable: false },
            { pubkey: configPda, isSigner: false, isWritable: false },
            { pubkey: mintBd.publicKey, isSigner: false, isWritable: false },
            { pubkey: payTokBd, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          ],
          encApproveAssetOnly(),
        ),
      ),
      [authority, payer],
    );
    const lot = await mintCoreLot(conn, stack, programId, payer, seller);
    const priceBd = 1_000n;
    await openDirectSpl(conn, ctx, lot, mintBd.publicKey, payTokBd, 0, Buffer.alloc(32, 0), priceBd);
    const bAta = Keypair.generate();
    const eAta = Keypair.generate();
    const pAta = Keypair.generate();
    const sAta = Keypair.generate();
    const [pClaim] = pda(programId, [SEED.claim, platform.publicKey.toBuffer(), mintBd.publicKey.toBuffer()]);
    const [pClaimAta] = pda(programId, [
      SEED.claimAta,
      platform.publicKey.toBuffer(),
      mintBd.publicKey.toBuffer(),
    ]);
    const [sClaim] = pda(programId, [SEED.claim, seller.publicKey.toBuffer(), mintBd.publicKey.toBuffer()]);
    const [sClaimAta] = pda(programId, [
      SEED.claimAta,
      seller.publicKey.toBuffer(),
      mintBd.publicKey.toBuffer(),
    ]);
    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: payer.publicKey,
          newAccountPubkey: bAta.publicKey,
          space: 165,
          lamports: ataRent,
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeAccount3Instruction(bAta.publicKey, mintBd.publicKey, buyer.publicKey),
        SystemProgram.createAccount({
          fromPubkey: payer.publicKey,
          newAccountPubkey: eAta.publicKey,
          space: 165,
          lamports: ataRent,
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeAccount3Instruction(eAta.publicKey, mintBd.publicKey, lot.escrow),
        createMintToInstruction(mintBd.publicKey, bAta.publicKey, payer.publicKey, Number(priceBd)),
        SystemProgram.createAccount({
          fromPubkey: payer.publicKey,
          newAccountPubkey: pAta.publicKey,
          space: 165,
          lamports: ataRent,
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeAccount3Instruction(pAta.publicKey, mintBd.publicKey, platform.publicKey),
        SystemProgram.createAccount({
          fromPubkey: payer.publicKey,
          newAccountPubkey: sAta.publicKey,
          space: 165,
          lamports: ataRent,
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeAccount3Instruction(sAta.publicKey, mintBd.publicKey, seller.publicKey),
      ),
      [payer, bAta, eAta, pAta, sAta],
    );
    ixBudget["Buy SPL direct"] = await sendAndMeasure(
      conn,
      payer,
      ix(
        programId,
        [
          ...buyHeadKeys({
            buyer: buyer.publicKey,
            config: configPda,
            consign: lot.consign,
            binding,
            passportConfig: stack.passportConfig,
            asset: lot.asset,
            custody: custodyPda,
            platform: platform.publicKey,
            seller: seller.publicKey,
            agent: agent.publicKey,
            recall: lot.recall,
            payer: payer.publicKey,
            escrow: lot.escrow,
            answerLeave: lot.answers.leave,
            answerOpen: lot.answers.open,
          }),
          { pubkey: bAta.publicKey, isSigner: false, isWritable: true },
          { pubkey: eAta.publicKey, isSigner: false, isWritable: true },
          { pubkey: mintBd.publicKey, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: pAta.publicKey, isSigner: false, isWritable: true },
          { pubkey: pClaim, isSigner: false, isWritable: true },
          { pubkey: pClaimAta, isSigner: false, isWritable: true },
          { pubkey: sAta.publicKey, isSigner: false, isWritable: true },
          { pubkey: sClaim, isSigner: false, isWritable: true },
          { pubkey: sClaimAta, isSigner: false, isWritable: true },
        ],
        Buffer.concat([Buffer.from([FP_IX.Buy]), lot.tokenId]),
      ),
      [buyer, payer],
    );
  }

  // Buy native agented
  {
    const lot = await mintCoreLot(conn, stack, programId, payer, seller);
    await addTransferDelegateToCustody(conn, seller, payer, lot.asset, custodyPda);
    const [mandate] = pda(programId, [SEED.mandate, lot.tokenId]);
    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        ix(
          programId,
          grantKeys({
            owner: seller.publicKey,
            binding,
            asset: lot.asset,
            mandate,
            consign: lot.consign,
            custody: custodyPda,
            payer: payer.publicKey,
          }),
          grantData(lot.tokenId, 700n, FORM_MARGIN, 0),
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
            mandate,
            binding,
            passportConfig: stack.passportConfig,
            asset: lot.asset,
            challenge: lot.challenge,
            mayAnswerOpen: lot.answers.open,
            consign: lot.consign,
            custody: custodyPda,
            payer: payer.publicKey,
            answerLeave: lot.answers.leave,
            answerOpen: lot.answers.open,
          }),
          Buffer.concat([
            Buffer.from([FP_IX.OpenFromMandate]),
            lot.tokenId,
            Buffer.from([0]),
            Buffer.alloc(32, 0),
            encU64(1_000),
          ]),
        ),
      ),
      [agent, payer],
    );
    ixBudget["Buy native agented"] = await sendAndMeasure(
      conn,
      payer,
      ix(
        programId,
        buyHeadKeys({
          buyer: buyer.publicKey,
          config: configPda,
          consign: lot.consign,
          binding,
          passportConfig: stack.passportConfig,
          asset: lot.asset,
          custody: custodyPda,
          platform: platform.publicKey,
          seller: seller.publicKey,
          agent: agent.publicKey,
          recall: lot.recall,
          payer: payer.publicKey,
          escrow: lot.escrow,
          answerLeave: lot.answers.leave,
          answerOpen: lot.answers.open,
        }),
        Buffer.concat([Buffer.from([FP_IX.Buy]), lot.tokenId]),
      ),
      [buyer, payer],
    );
  }

  // Buy SPL agented (fiat Margin — heaviest; ALT when legacy > 1232)
  {
    await seedPrice("lab-fresh_narrow.bin", nowUnix);
    const lot = await mintCoreLot(conn, stack, programId, payer, seller);
    await addTransferDelegateToCustody(conn, seller, payer, lot.asset, custodyPda);
    const [mandate] = pda(programId, [SEED.mandate, lot.tokenId]);
    const floor1e8 = 100_0000_0000n;
    const price1e8 = 150_0000_0000n;
    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        ix(
          programId,
          grantKeys({
            owner: seller.publicKey,
            binding,
            asset: lot.asset,
            mandate,
            consign: lot.consign,
            custody: custodyPda,
            payer: payer.publicKey,
          }),
          grantData(lot.tokenId, floor1e8, FORM_MARGIN, 0, mintFiat.publicKey, DENOM_FIAT, CURRENCY_USD),
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
            mandate,
            paymentTok: payTokFiat,
            binding,
            passportConfig: stack.passportConfig,
            asset: lot.asset,
            challenge: lot.challenge,
            mayAnswerOpen: lot.answers.open,
            consign: lot.consign,
            custody: custodyPda,
            payer: payer.publicKey,
            answerLeave: lot.answers.leave,
            answerOpen: lot.answers.open,
          }),
          Buffer.concat([
            Buffer.from([FP_IX.OpenFromMandate]),
            lot.tokenId,
            Buffer.from([DENOM_FIAT]),
            CURRENCY_USD,
            encU64(price1e8),
          ]),
        ),
      ),
      [agent, payer],
    );
    const bAta = Keypair.generate();
    const eAta = Keypair.generate();
    const pAta = Keypair.generate();
    const sAta = Keypair.generate();
    const aAta = Keypair.generate();
    const [pClaim] = pda(programId, [
      SEED.claim,
      platform.publicKey.toBuffer(),
      mintFiat.publicKey.toBuffer(),
    ]);
    const [pClaimAta] = pda(programId, [
      SEED.claimAta,
      platform.publicKey.toBuffer(),
      mintFiat.publicKey.toBuffer(),
    ]);
    const [sClaim] = pda(programId, [
      SEED.claim,
      seller.publicKey.toBuffer(),
      mintFiat.publicKey.toBuffer(),
    ]);
    const [sClaimAta] = pda(programId, [
      SEED.claimAta,
      seller.publicKey.toBuffer(),
      mintFiat.publicKey.toBuffer(),
    ]);
    const [aClaim] = pda(programId, [
      SEED.claim,
      agent.publicKey.toBuffer(),
      mintFiat.publicKey.toBuffer(),
    ]);
    const [aClaimAta] = pda(programId, [
      SEED.claimAta,
      agent.publicKey.toBuffer(),
      mintFiat.publicKey.toBuffer(),
    ]);
    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: payer.publicKey,
          newAccountPubkey: bAta.publicKey,
          space: 165,
          lamports: ataRent,
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeAccount3Instruction(bAta.publicKey, mintFiat.publicKey, buyer.publicKey),
        SystemProgram.createAccount({
          fromPubkey: payer.publicKey,
          newAccountPubkey: eAta.publicKey,
          space: 165,
          lamports: ataRent,
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeAccount3Instruction(eAta.publicKey, mintFiat.publicKey, lot.escrow),
        createMintToInstruction(mintFiat.publicKey, bAta.publicKey, payer.publicKey, 2_000_000),
        SystemProgram.createAccount({
          fromPubkey: payer.publicKey,
          newAccountPubkey: pAta.publicKey,
          space: 165,
          lamports: ataRent,
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeAccount3Instruction(pAta.publicKey, mintFiat.publicKey, platform.publicKey),
        SystemProgram.createAccount({
          fromPubkey: payer.publicKey,
          newAccountPubkey: sAta.publicKey,
          space: 165,
          lamports: ataRent,
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeAccount3Instruction(sAta.publicKey, mintFiat.publicKey, seller.publicKey),
        SystemProgram.createAccount({
          fromPubkey: payer.publicKey,
          newAccountPubkey: aAta.publicKey,
          space: 165,
          lamports: ataRent,
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeAccount3Instruction(aAta.publicKey, mintFiat.publicKey, agent.publicKey),
      ),
      [payer, bAta, eAta, pAta, sAta, aAta],
    );
    ixBudget["Buy SPL agented"] = await sendAndMeasure(
      conn,
      payer,
      ix(
        programId,
        [
          ...buyHeadKeys({
            buyer: buyer.publicKey,
            config: configPda,
            consign: lot.consign,
            binding,
            passportConfig: stack.passportConfig,
            asset: lot.asset,
            custody: custodyPda,
            platform: platform.publicKey,
            seller: seller.publicKey,
            agent: agent.publicKey,
            recall: lot.recall,
            payer: payer.publicKey,
            escrow: lot.escrow,
            answerLeave: lot.answers.leave,
            answerOpen: lot.answers.open,
          }),
          { pubkey: payTokFiat, isSigner: false, isWritable: false },
          { pubkey: priceLabPda, isSigner: false, isWritable: false },
          { pubkey: bAta.publicKey, isSigner: false, isWritable: true },
          { pubkey: eAta.publicKey, isSigner: false, isWritable: true },
          { pubkey: mintFiat.publicKey, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: pAta.publicKey, isSigner: false, isWritable: true },
          { pubkey: pClaim, isSigner: false, isWritable: true },
          { pubkey: pClaimAta, isSigner: false, isWritable: true },
          { pubkey: sAta.publicKey, isSigner: false, isWritable: true },
          { pubkey: sClaim, isSigner: false, isWritable: true },
          { pubkey: sClaimAta, isSigner: false, isWritable: true },
          { pubkey: aAta.publicKey, isSigner: false, isWritable: true },
          { pubkey: aClaim, isSigner: false, isWritable: true },
          { pubkey: aClaimAta, isSigner: false, isWritable: true },
        ],
        Buffer.concat([Buffer.from([FP_IX.Buy]), lot.tokenId]),
      ),
      [buyer, payer],
    );
  }

  // ConfirmExternalPayment
  {
    const lot = await mintCoreLot(conn, stack, programId, payer, seller);
    const [note] = pda(programId, [SEED.settlementNote, lot.tokenId]);
    await openDirectNative(conn, ctx, lot, 777n);
    const noteBytes = Buffer.alloc(256);
    Buffer.from("budget note").copy(noteBytes);
    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        ix(
          programId,
          [
            { pubkey: seller.publicKey, isSigner: true, isWritable: false },
            { pubkey: lot.consign, isSigner: false, isWritable: false },
            { pubkey: note, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          ],
          Buffer.concat([
            Buffer.from([FP_IX.SetSettlementNote]),
            lot.tokenId,
            noteBytes,
            encU32(11),
          ]),
        ),
      ),
      [seller, payer],
    );
    ixBudget.ConfirmExternalPayment = await sendAndMeasure(
      conn,
      payer,
      ix(
        programId,
        confirmExternalKeys({
          caller: seller.publicKey,
          consign: lot.consign,
          note,
          recall: lot.recall,
          binding,
          passportConfig: stack.passportConfig,
          asset: lot.asset,
          custody: custodyPda,
          buyer: buyer.publicKey,
          payer: payer.publicKey,
          answerLeave: lot.answers.leave,
          answerOpen: lot.answers.open,
        }),
        Buffer.concat([
          Buffer.from([FP_IX.ConfirmExternalPayment]),
          lot.tokenId,
          buyer.publicKey.toBuffer(),
        ]),
      ),
      [seller, payer],
    );
  }

  const splAgented = ixBudget["Buy SPL agented"]!;
  assert.ok(splAgented.legacyTx > 1232, "agented SPL Buy legacy must exceed 1232");
  assert.ok(splAgented.versionedTx != null, "agented SPL Buy must record versionedTx via ALT");

  let ixBudgetHeaviest = "Bind";
  let heaviestLegacy = -1;
  for (const [name, row] of Object.entries(ixBudget)) {
    if (row.legacyTx > heaviestLegacy) {
      heaviestLegacy = row.legacyTx;
      ixBudgetHeaviest = name;
    }
  }
  assert.equal(ixBudgetHeaviest, "Buy SPL agented");

  console.warn("\n[svm-stand] FixedPrice per-ix budget (registry N=1):");
  console.warn(
    [
      "ix".padEnd(28),
      "accts".padStart(5),
      "sigs".padStart(5),
      "wrt".padStart(5),
      "cu".padStart(8),
      "legacy".padStart(8),
      "v0".padStart(8),
    ].join(" "),
  );
  for (const [name, row] of Object.entries(ixBudget)) {
    console.warn(
      [
        name.padEnd(28),
        String(row.accounts).padStart(5),
        String(row.signers).padStart(5),
        String(row.writable).padStart(5),
        String(row.cu ?? "-").padStart(8),
        String(row.legacyTx).padStart(8),
        String(row.versionedTx ?? "-").padStart(8),
      ].join(" "),
    );
  }
  console.warn(`[svm-stand] heaviest=${ixBudgetHeaviest} legacy=${heaviestLegacy}\n`);

  return withStandArtifactBindings({
    unboundOpenCode,
    rebindCode,
    frozenOpenCode,
    frozenCustodyLocked,
    frozenPermanentFreeze,
    registryMissCode,
    retiredIxCode,
    nativeBuy: {
      phase: closedN.phase,
      buyerOwns: buyerOwnsN,
      platformDelta: balP1 - balP0,
      sellerDelta: balS1 - balS0,
      agentDelta: balA1 - balA0,
      price: priceN,
      feeBps: lotNData.feeBps,
    },
    fiatRefuseCode,
    fiatNoFeedCode,
    staleBuyCode,
    wideConfCode,
    badOracleCode,
    fiatFresh: {
      phase: freshClosed.phase,
      buyerOwns: freshOwner.equals(buyer.publicKey),
      expectedAssetAmt: Number(expectedAssetAmt),
    },
    fiatAgented: {
      floorBefore,
      floorAfter: lotAgAfter.floor,
      expectedFloorAsset,
      ownerDelta: ownerDeltaAg,
      agentDelta: agentDeltaAg,
      platformDelta: platformDeltaAg,
      amount: amountAg,
      buyLegacyWouldBe: agentedBuyAlt.legacyWouldBe,
      buyVersionedSize: agentedBuyAlt.versionedSize,
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
    leaveChainWhileLive: leaveChainWhileLive!,
    leaveChainAfterClose,
    leaveChainSendWhileLive: leaveChainSendWhileLive!,
    leaveChainSendAfterClose,
    revokeOpenCode,
    transferDelegateAfterRevoke,
    ixBudget,
    ixBudgetHeaviest,
  });
}
