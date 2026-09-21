/**
 * Shared stand helpers for FixedPrice (S8-E step 5) Core + passport path.
 *
 * Extends patterns from live-roundtrip / live-verifier-flow / live-core-custody:
 * passport+gateway init, MintPassport, BindPassportProgram, AddEncumbranceSource,
 * TransferDelegate (mpl-core), encumbrance answer PDAs, Core owner / delegate reads.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  STAND_SVM_EID,
  STAND_SVM_NAMESPACE,
} from "./constants.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(__dirname, "../lab/package.json"));
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  AddressLookupTableProgram,
  sendAndConfirmTransaction,
} = require("@solana/web3.js") as typeof import("@solana/web3.js");

const ROOT = path.resolve(__dirname, "../..");
const DEPLOY = path.join(ROOT, "svm/target/deploy");

export const CORE_ID = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
export const RPC_DEFAULT = process.env.SVM_STAND_RPC ?? "http://127.0.0.1:8899";

/** Encumbrance answer seed_prefix registered for FixedPrice (≤32 bytes). */
export const ENCUMBRANCE_SEED_PREFIX = Buffer.from("ans");

export const SEED = {
  config: Buffer.from("config"),
  asset: Buffer.from("asset"),
  state: Buffer.from("state"),
  challenge: Buffer.from("challenge"),
  freeze: Buffer.from("freeze"),
  epConfig: Buffer.from("ep_config"),
  consignConfig: Buffer.from("consign-config"),
  custody: Buffer.from("custody"),
  consignment: Buffer.from("consignment"),
  mandate: Buffer.from("mandate"),
  recall: Buffer.from("recall"),
  escrow: Buffer.from("escrow"),
  settlementNote: Buffer.from("settlement-note"),
  paymentToken: Buffer.from("payment-token"),
  passportBind: Buffer.from("passport-bind"),
  priceLab: Buffer.from("price-lab"),
  claim: Buffer.from("claim"),
  claimAta: Buffer.from("claim-ata"),
} as const;

/** PassportIx discriminants (append-only). */
export const PASSPORT_IX = {
  Initialize: 0,
  SetBridgeGateway: 1,
  MintPassport: 2,
  May: 4,
  AddEncumbranceSource: 21,
} as const;

/** FixedPriceIx — BindPassportProgram appended at 27. */
export const FP_IX = {
  InitConfig: 0,
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
  BindPassportProgram: 27,
} as const;

/** HarnessIx — CoreAddTransferDelegate appended after SkipFreeze (25). */
export const HARNESS_IX = {
  CoreAddTransferDelegate: 26,
} as const;

export const INTENT = { LeaveChain: 0, OpenConsignment: 1 } as const;

/** PassportConfig.next_token_id offset (disc+authority+ns+eid+endpoint+deposit+staking+forfeit+gateway). */
export const NEXT_TOKEN_ID_OFFSET = 8 + 32 + 16 + 4 + 32 + 8 + 32 + 32 + 32;

export type Pk = InstanceType<typeof PublicKey>;
export type Kp = InstanceType<typeof Keypair>;
export type Conn = InstanceType<typeof Connection>;
export type Meta = { pubkey: Pk; isSigner: boolean; isWritable: boolean };

export type PassportCommerceStack = {
  passportProgram: Pk;
  gatewayProgram: Pk;
  endpointProgram: Pk;
  passportConfig: Pk;
  gatewayConfig: Pk;
  gatewayFreeze: Pk;
  /** Passport config authority (= Initialize payer). */
  passportAuthority: Kp;
};

export function loadDeployProgramId(name: string): Pk {
  const kpPath = path.join(DEPLOY, `${name}-keypair.json`);
  if (!existsSync(kpPath)) {
    throw new Error(`missing ${kpPath} — build with cargo-build-sbf`);
  }
  const secret = Uint8Array.from(JSON.parse(readFileSync(kpPath, "utf8")));
  return Keypair.fromSecretKey(secret).publicKey;
}

export function pda(programId: Pk, seeds: (Buffer | Uint8Array)[]): [Pk, number] {
  return PublicKey.findProgramAddressSync(seeds, programId);
}

export function ix(programId: Pk, keys: Meta[], data: Buffer) {
  return new TransactionInstruction({ programId, keys, data });
}

/**
 * Create a one-slot ALT and send a versioned transaction through it.
 * Used when Core passport buy metas exceed the legacy 1232-byte limit (D-28 heaviest).
 * Returns serialized legacy-equivalent size estimate before ALT and the sent vtx size.
 */
export async function sendIxWithAlt(
  conn: Conn,
  payer: Kp,
  instruction: InstanceType<typeof TransactionInstruction>,
  signers: Kp[],
): Promise<{
  signature: string;
  legacyWouldBe: number;
  versionedSize: number;
  alt: Pk;
}> {
  const slot = await conn.getSlot("confirmed");
  const [createIx, altAddress] = AddressLookupTableProgram.createLookupTable({
    authority: payer.publicKey,
    payer: payer.publicKey,
    recentSlot: slot - 1,
  });
  const unique = new Map<string, Pk>();
  for (const k of instruction.keys) {
    unique.set(k.pubkey.toBase58(), k.pubkey);
  }
  unique.set(instruction.programId.toBase58(), instruction.programId);
  const addresses = [...unique.values()];

  await sendAndConfirmTransaction(conn, new Transaction().add(createIx), [payer]);

  // extendLookupTable max ~20 addresses per ix — chunk.
  const CHUNK = 20;
  for (let i = 0; i < addresses.length; i += CHUNK) {
    const chunk = addresses.slice(i, i + CHUNK);
    const extendIx = AddressLookupTableProgram.extendLookupTable({
      payer: payer.publicKey,
      authority: payer.publicKey,
      lookupTable: altAddress,
      addresses: chunk,
    });
    await sendAndConfirmTransaction(conn, new Transaction().add(extendIx), [payer]);
  }
  // Wait so the ALT is active for lookups.
  await new Promise((r) => setTimeout(r, 1500));
  const { value: altAccount } = await conn.getAddressLookupTable(altAddress);
  if (!altAccount) throw new Error("ALT not found after create");

  // Measure legacy size without serializing a send (avoids 1232 throw).
  const legacyProbe = new Transaction().add(instruction);
  legacyProbe.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  legacyProbe.feePayer = payer.publicKey;
  for (const s of signers) legacyProbe.partialSign(s);
  let legacyWouldBe = 0;
  try {
    legacyWouldBe = legacyProbe.serialize({
      requireAllSignatures: true,
      verifySignatures: false,
    }).length;
  } catch {
    // Oversize — estimate from message + sigs
    legacyWouldBe = legacyProbe.serializeMessage().length + 64 * Math.max(signers.length, 1) + 1;
  }

  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions: [instruction],
  }).compileToV0Message([altAccount]);
  const vtx = new VersionedTransaction(msg);
  vtx.sign(signers);
  const versionedSize = vtx.serialize().length;
  const signature = await conn.sendTransaction(vtx, { skipPreflight: false });
  await conn.confirmTransaction(signature, "confirmed");
  return { signature, legacyWouldBe, versionedSize, alt: altAddress };
}

export function encU16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n, 0);
  return b;
}
export function encU32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n, 0);
  return b;
}
export function encU64(n: bigint | number): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n), 0);
  return b;
}
export function encI64(n: bigint | number): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(BigInt(n), 0);
  return b;
}

function encodeU128Le(n: bigint): Buffer {
  const buf = Buffer.alloc(16);
  let x = n;
  for (let i = 0; i < 16; i++) {
    buf[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return buf;
}

function encodeString(s: string): Buffer {
  const b = Buffer.from(s, "utf8");
  const out = Buffer.alloc(4 + b.length);
  out.writeUInt32LE(b.length, 0);
  b.copy(out, 4);
  return out;
}

function encodeVecU8(data: Uint8Array): Buffer {
  const out = Buffer.alloc(4 + data.length);
  out.writeUInt32LE(data.length, 0);
  Buffer.from(data).copy(out, 4);
  return out;
}

export async function airdrop(conn: Conn, kp: Kp, sol = 20) {
  const sig = await conn.requestAirdrop(kp.publicKey, sol * 1e9);
  await conn.confirmTransaction(sig, "confirmed");
}

export function customErrCode(e: unknown): number | null {
  const msg = e instanceof Error ? e.message : String(e);
  const m = msg.match(/custom program error: (0x[0-9a-fA-F]+|\d+)/);
  if (!m) return null;
  const raw = m[1]!;
  return raw.startsWith("0x") ? parseInt(raw, 16) : parseInt(raw, 10);
}

export async function expectCustom(
  conn: Conn,
  tx: InstanceType<typeof Transaction>,
  signers: Kp[],
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

/** Core BaseAssetV1 owner. */
export function coreOwner(data: Buffer): Pk {
  return new PublicKey(data.subarray(1, 33));
}

const PLUGIN_TRANSFER_DELEGATE = 3;
const AUTH_OWNER = 1;
const AUTH_ADDRESS = 3;

/** Whether TransferDelegate plugin exists with Address authority == expected. */
export function hasTransferDelegateAddress(data: Buffer, expected: Pk): boolean {
  let i = 1;
  i += 32;
  const ua = data[i++]!;
  if (ua === 1 || ua === 2) i += 32;
  const nameLen = data.readUInt32LE(i);
  i += 4 + nameLen;
  const uriLen = data.readUInt32LE(i);
  i += 4 + uriLen;
  const seq = data[i++]!;
  if (seq === 1) i += 8;
  if (data[i] !== 3) return false;
  i += 1;
  const registryOffset = Number(data.readBigUInt64LE(i));
  i = registryOffset;
  if (data[i] !== 4) return false;
  i += 1;
  const n = data.readUInt32LE(i);
  i += 4;
  for (let r = 0; r < n; r++) {
    const pluginType = data[i++]!;
    const authDisc = data[i++]!;
    let addr: Pk | null = null;
    if (authDisc === AUTH_ADDRESS) {
      addr = new PublicKey(data.subarray(i, i + 32));
      i += 32;
    }
    i += 8;
    if (pluginType === PLUGIN_TRANSFER_DELEGATE && authDisc === AUTH_ADDRESS && addr) {
      if (addr.equals(expected)) return true;
    }
    if (pluginType === PLUGIN_TRANSFER_DELEGATE && authDisc === AUTH_OWNER) {
      return false;
    }
  }
  return false;
}

/** EncumbranceAnswer.allowed at offset disc(8)+token(32)+intent(1). */
export function readAnswerAllowed(data: Buffer): boolean {
  return data[8 + 32 + 1]! !== 0;
}

export function answerPdas(
  modeProgram: Pk,
  tokenId: Buffer,
  seedPrefix: Buffer = ENCUMBRANCE_SEED_PREFIX,
): { leave: Pk; open: Pk } {
  const [leave] = pda(modeProgram, [seedPrefix, tokenId, Buffer.from([INTENT.LeaveChain])]);
  const [open] = pda(modeProgram, [seedPrefix, tokenId, Buffer.from([INTENT.OpenConsignment])]);
  return { leave, open };
}

/**
 * Stand deployer key — same as live-roundtrip / live-verifier
 * (`SOLANA_KEYPAIR` or `~/.config/solana/id.json`). Passport config authority
 * on a shared validator is this key; random payers cannot AddEncumbranceSource.
 */
export function loadStandDeployerKeypair(): Kp {
  const p =
    process.env.SOLANA_KEYPAIR ?? `${process.env.HOME}/.config/solana/id.json`;
  const raw = JSON.parse(readFileSync(p, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

/**
 * Ensure passport + mock endpoint + gateway are initialised (idempotent).
 * Always uses the stand deployer as passport authority (must match Initialize).
 */
export async function ensurePassportCommerceStack(
  conn: Conn,
): Promise<PassportCommerceStack> {
  const passportAuthority = loadStandDeployerKeypair();
  const bal = await conn.getBalance(passportAuthority.publicKey);
  if (bal < 2_000_000_000) {
    const sig = await conn.requestAirdrop(passportAuthority.publicKey, 5_000_000_000);
    await conn.confirmTransaction(sig, "confirmed");
  }

  const passportProgram = loadDeployProgramId("kar_passport");
  const gatewayProgram = loadDeployProgramId("kar_gateway");
  const endpointProgram = loadDeployProgramId("mock_endpoint");
  const stakingProgram = loadDeployProgramId("mock_staking");

  const [passportConfig] = pda(passportProgram, [SEED.config]);
  const [gatewayConfig] = pda(gatewayProgram, [SEED.config]);
  const [gatewayFreeze] = pda(gatewayProgram, [SEED.freeze]);
  const [endpointConfig] = pda(endpointProgram, [SEED.epConfig]);

  if (!(await conn.getAccountInfo(endpointConfig))) {
    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        ix(
          endpointProgram,
          [
            { pubkey: endpointConfig, isSigner: false, isWritable: true },
            { pubkey: passportAuthority.publicKey, isSigner: true, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          Buffer.from([0]),
        ),
      ),
      [passportAuthority],
    );
  }

  if (!(await conn.getAccountInfo(passportConfig))) {
    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        ix(
          passportProgram,
          [
            { pubkey: passportConfig, isSigner: false, isWritable: true },
            { pubkey: passportAuthority.publicKey, isSigner: true, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          Buffer.concat([
            Buffer.from([PASSPORT_IX.Initialize]),
            encodeU128Le(STAND_SVM_NAMESPACE),
            encU32(STAND_SVM_EID),
            endpointProgram.toBuffer(),
            encU64(1_000_000n),
            stakingProgram.toBuffer(),
            passportAuthority.publicKey.toBuffer(),
          ]),
        ),
      ),
      [passportAuthority],
    );
  }

  if (!(await conn.getAccountInfo(gatewayConfig))) {
    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        ix(
          gatewayProgram,
          [
            { pubkey: gatewayConfig, isSigner: false, isWritable: true },
            { pubkey: passportAuthority.publicKey, isSigner: true, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          Buffer.concat([
            Buffer.from([0]),
            encU32(STAND_SVM_EID),
            endpointProgram.toBuffer(),
            passportProgram.toBuffer(),
            encodeU128Le(STAND_SVM_NAMESPACE),
          ]),
        ),
      ),
      [passportAuthority],
    );
  }

  // SetBridgeGateway if still zero
  {
    const cfg = (await conn.getAccountInfo(passportConfig))!.data as Buffer;
    const gwOff = 8 + 32 + 16 + 4 + 32 + 8 + 32 + 32;
    const gw = new PublicKey(cfg.subarray(gwOff, gwOff + 32));
    if (gw.equals(PublicKey.default)) {
      await sendAndConfirmTransaction(
        conn,
        new Transaction().add(
          ix(
            passportProgram,
            [
              { pubkey: passportConfig, isSigner: false, isWritable: true },
              { pubkey: passportAuthority.publicKey, isSigner: true, isWritable: false },
            ],
            Buffer.concat([
              Buffer.from([PASSPORT_IX.SetBridgeGateway]),
              gatewayConfig.toBuffer(),
            ]),
          ),
        ),
        [passportAuthority],
      );
    }
  }

  return {
    passportProgram,
    gatewayProgram,
    endpointProgram,
    passportConfig,
    gatewayConfig,
    gatewayFreeze,
    passportAuthority,
  };
}

/** Register FixedPrice as encumbrance source (idempotent by SourceAlreadyRegistered). */
export async function addEncumbranceSource(
  conn: Conn,
  stack: PassportCommerceStack,
  sourceProgram: Pk,
  seedPrefix: Buffer = ENCUMBRANCE_SEED_PREFIX,
): Promise<void> {
  try {
    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        ix(
          stack.passportProgram,
          [
            { pubkey: stack.passportConfig, isSigner: false, isWritable: true },
            { pubkey: stack.passportAuthority.publicKey, isSigner: true, isWritable: false },
            { pubkey: stack.passportAuthority.publicKey, isSigner: true, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          Buffer.concat([
            Buffer.from([PASSPORT_IX.AddEncumbranceSource]),
            sourceProgram.toBuffer(),
            encodeVecU8(seedPrefix),
          ]),
        ),
      ),
      [stack.passportAuthority],
    );
  } catch (e) {
    const code = customErrCode(e);
    // SourceAlreadyRegistered = 17 — tolerate re-run on shared validator
    if (code !== 17) throw e;
  }
}

export async function bindPassportProgram(
  conn: Conn,
  modeProgram: Pk,
  configPda: Pk,
  authority: Kp,
  payer: Kp,
  passportProgram: Pk,
): Promise<Pk> {
  const [binding] = pda(modeProgram, [SEED.passportBind]);
  if (await conn.getAccountInfo(binding)) return binding;
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        modeProgram,
        [
          { pubkey: authority.publicKey, isSigner: true, isWritable: false },
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: binding, isSigner: false, isWritable: true },
          { pubkey: passportProgram, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        ],
        Buffer.from([FP_IX.BindPassportProgram]),
      ),
    ),
    [authority, payer],
  );
  return binding;
}

export async function mintPassportAsset(
  conn: Conn,
  stack: PassportCommerceStack,
  payer: Kp,
  owner: Pk,
  uri = "ar://fp-stand-core",
): Promise<{ tokenId: Buffer; asset: Pk; state: Pk; challenge: Pk }> {
  const cfgInfo = await conn.getAccountInfo(stack.passportConfig);
  if (!cfgInfo) throw new Error("passport config missing");
  const tokenId = Buffer.from(
    (cfgInfo.data as Buffer).subarray(NEXT_TOKEN_ID_OFFSET, NEXT_TOKEN_ID_OFFSET + 32),
  );
  const [asset] = pda(stack.passportProgram, [SEED.asset, tokenId]);
  const [state] = pda(stack.passportProgram, [SEED.state, tokenId]);
  const [challenge] = pda(stack.passportProgram, [SEED.challenge, tokenId]);

  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        stack.passportProgram,
        [
          { pubkey: stack.passportConfig, isSigner: false, isWritable: true },
          { pubkey: stack.passportAuthority.publicKey, isSigner: true, isWritable: false },
          { pubkey: asset, isSigner: false, isWritable: true },
          { pubkey: state, isSigner: false, isWritable: true },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: owner, isSigner: false, isWritable: false },
          { pubkey: stack.gatewayFreeze, isSigner: false, isWritable: false },
          { pubkey: CORE_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        Buffer.concat([Buffer.from([PASSPORT_IX.MintPassport]), encodeString(uri)]),
      ),
    ),
    [stack.passportAuthority, payer],
  );
  return { tokenId, asset, state, challenge };
}

/** Owner attaches TransferDelegate → custody via harness Core AddPlugin CPI. */
export async function addTransferDelegateToCustody(
  conn: Conn,
  owner: Kp,
  payer: Kp,
  asset: Pk,
  custody: Pk,
): Promise<void> {
  const harness = loadDeployProgramId("consignment_harness");
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        harness,
        [
          { pubkey: owner.publicKey, isSigner: true, isWritable: false },
          { pubkey: asset, isSigner: false, isWritable: true },
          { pubkey: custody, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: CORE_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        Buffer.from([HARNESS_IX.CoreAddTransferDelegate]),
      ),
    ),
    [owner, payer],
  );
}

/**
 * May LeaveChain via PassportIx::May.
 * Returns null on success (allowed); custom error code on refusal.
 */
export async function tryMayLeaveChain(
  conn: Conn,
  stack: PassportCommerceStack,
  payer: Kp,
  tokenId: Buffer,
  asset: Pk,
  challenge: Pk,
  modeProgram: Pk,
  seedPrefix: Buffer = ENCUMBRANCE_SEED_PREFIX,
): Promise<number | null> {
  const [answerLeave] = pda(modeProgram, [
    seedPrefix,
    tokenId,
    Buffer.from([INTENT.LeaveChain]),
  ]);
  const tx = new Transaction().add(
    ix(
      stack.passportProgram,
      [
        { pubkey: stack.passportConfig, isSigner: false, isWritable: false },
        { pubkey: asset, isSigner: false, isWritable: false },
        { pubkey: challenge, isSigner: false, isWritable: false },
        { pubkey: answerLeave, isSigner: false, isWritable: false },
      ],
      Buffer.concat([
        Buffer.from([PASSPORT_IX.May]),
        tokenId,
        Buffer.from([INTENT.LeaveChain]),
      ]),
    ),
  );
  try {
    await sendAndConfirmTransaction(conn, tx, [payer], { commitment: "confirmed" });
    return null;
  } catch (e) {
    return customErrCode(e);
  }
}

/** OpenDirect account metas (native or SPL). paymentTok after config when SPL. */
export function openDirectKeys(args: {
  seller: Pk;
  config: Pk;
  paymentTok?: Pk;
  binding: Pk;
  passportConfig: Pk;
  asset: Pk;
  challenge: Pk;
  mayAnswerOpen: Pk;
  consign: Pk;
  custody: Pk;
  payer: Pk;
}): Meta[] {
  const keys: Meta[] = [
    { pubkey: args.seller, isSigner: true, isWritable: false },
    { pubkey: args.config, isSigner: false, isWritable: false },
  ];
  if (args.paymentTok) {
    keys.push({ pubkey: args.paymentTok, isSigner: false, isWritable: false });
  }
  keys.push(
    { pubkey: args.binding, isSigner: false, isWritable: false },
    { pubkey: args.passportConfig, isSigner: false, isWritable: false },
    { pubkey: args.asset, isSigner: false, isWritable: true },
    { pubkey: args.challenge, isSigner: false, isWritable: false },
    { pubkey: args.mayAnswerOpen, isSigner: false, isWritable: false },
    { pubkey: args.consign, isSigner: false, isWritable: true },
    { pubkey: args.custody, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: args.payer, isSigner: true, isWritable: true },
    { pubkey: CORE_ID, isSigner: false, isWritable: false },
  );
  return keys;
}

/** Append answer_leave + answer_open after CORE_ID in open keys. */
export function withOpenAnswers(keys: Meta[], leave: Pk, open: Pk): Meta[] {
  return [
    ...keys,
    { pubkey: leave, isSigner: false, isWritable: true },
    { pubkey: open, isSigner: false, isWritable: true },
  ];
}

export function grantKeys(args: {
  owner: Pk;
  binding: Pk;
  asset: Pk;
  mandate: Pk;
  consign: Pk;
  custody: Pk;
  payer: Pk;
}): Meta[] {
  return [
    { pubkey: args.owner, isSigner: true, isWritable: false },
    { pubkey: args.binding, isSigner: false, isWritable: false },
    { pubkey: args.asset, isSigner: false, isWritable: false },
    { pubkey: args.mandate, isSigner: false, isWritable: true },
    { pubkey: args.consign, isSigner: false, isWritable: false },
    { pubkey: args.custody, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: args.payer, isSigner: true, isWritable: true },
  ];
}

export function openFromMandateKeys(args: {
  agent: Pk;
  config: Pk;
  mandate: Pk;
  paymentTok?: Pk;
  binding: Pk;
  passportConfig: Pk;
  asset: Pk;
  challenge: Pk;
  mayAnswerOpen: Pk;
  consign: Pk;
  custody: Pk;
  payer: Pk;
  answerLeave: Pk;
  answerOpen: Pk;
}): Meta[] {
  const keys: Meta[] = [
    { pubkey: args.agent, isSigner: true, isWritable: false },
    { pubkey: args.config, isSigner: false, isWritable: false },
    { pubkey: args.mandate, isSigner: false, isWritable: false },
  ];
  if (args.paymentTok) {
    keys.push({ pubkey: args.paymentTok, isSigner: false, isWritable: false });
  }
  keys.push(
    { pubkey: args.binding, isSigner: false, isWritable: false },
    { pubkey: args.passportConfig, isSigner: false, isWritable: false },
    { pubkey: args.asset, isSigner: false, isWritable: true },
    { pubkey: args.challenge, isSigner: false, isWritable: false },
    { pubkey: args.mayAnswerOpen, isSigner: false, isWritable: false },
    { pubkey: args.consign, isSigner: false, isWritable: true },
    { pubkey: args.custody, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: args.payer, isSigner: true, isWritable: true },
    { pubkey: CORE_ID, isSigner: false, isWritable: false },
    { pubkey: args.answerLeave, isSigner: false, isWritable: true },
    { pubkey: args.answerOpen, isSigner: false, isWritable: true },
  );
  return keys;
}

/** Buy head metas through answer_open (native or before fiat/SPL tail). */
export function buyHeadKeys(args: {
  buyer: Pk;
  config: Pk;
  consign: Pk;
  binding: Pk;
  passportConfig: Pk;
  asset: Pk;
  custody: Pk;
  platform: Pk;
  seller: Pk;
  agent: Pk;
  recall: Pk;
  payer: Pk;
  escrow: Pk;
  answerLeave: Pk;
  answerOpen: Pk;
}): Meta[] {
  return [
    { pubkey: args.buyer, isSigner: true, isWritable: true },
    { pubkey: args.config, isSigner: false, isWritable: false },
    { pubkey: args.consign, isSigner: false, isWritable: true },
    { pubkey: args.binding, isSigner: false, isWritable: false },
    { pubkey: args.passportConfig, isSigner: false, isWritable: false },
    { pubkey: args.asset, isSigner: false, isWritable: true },
    { pubkey: args.custody, isSigner: false, isWritable: false },
    { pubkey: args.platform, isSigner: false, isWritable: true },
    { pubkey: args.seller, isSigner: false, isWritable: true },
    { pubkey: args.agent, isSigner: false, isWritable: true },
    { pubkey: args.recall, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: args.payer, isSigner: true, isWritable: true },
    { pubkey: args.escrow, isSigner: false, isWritable: true },
    { pubkey: CORE_ID, isSigner: false, isWritable: false },
    { pubkey: args.answerLeave, isSigner: false, isWritable: true },
    { pubkey: args.answerOpen, isSigner: false, isWritable: true },
  ];
}

export function confirmExternalKeys(args: {
  caller: Pk;
  consign: Pk;
  note: Pk;
  recall: Pk;
  binding: Pk;
  passportConfig: Pk;
  asset: Pk;
  custody: Pk;
  buyer: Pk;
  payer: Pk;
  answerLeave: Pk;
  answerOpen: Pk;
}): Meta[] {
  return [
    { pubkey: args.caller, isSigner: true, isWritable: false },
    { pubkey: args.consign, isSigner: false, isWritable: true },
    { pubkey: args.note, isSigner: false, isWritable: true },
    { pubkey: args.recall, isSigner: false, isWritable: true },
    { pubkey: args.binding, isSigner: false, isWritable: false },
    { pubkey: args.passportConfig, isSigner: false, isWritable: false },
    { pubkey: args.asset, isSigner: false, isWritable: true },
    { pubkey: args.custody, isSigner: false, isWritable: false },
    { pubkey: args.buyer, isSigner: false, isWritable: false },
    { pubkey: args.payer, isSigner: true, isWritable: true },
    { pubkey: CORE_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: args.answerLeave, isSigner: false, isWritable: true },
    { pubkey: args.answerOpen, isSigner: false, isWritable: true },
  ];
}
