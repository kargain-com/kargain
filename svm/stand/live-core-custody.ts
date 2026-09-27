/**
 * Local-validator proof: Core custody helpers in kargain-consignment-base (S8-E step 4).
 *
 * Harness proves the shared owner via thin IXs (not commercial modes):
 * - owner → custody
 * - custody-as-TransferDelegate → custody
 * - custody → recipient + fact (a): TransferDelegate authority resets to Owner
 * - fact (b): require_not_frozen → AssetFrozen(137); skip gate → Core InvalidAuthority(9)
 * - negatives: wrong token PDA; foreign delegate; unsigned owner
 *
 * Requires: local validator, consignment_harness.so + mpl-core preloaded.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  sendAndConfirmStandTransaction as sendAndConfirmTransaction,
  standRequestAirdropAndConfirm,
  confirmStandSentSignature,
} from "./stand-tx-confirm.ts";
import { expectStandTransactionRefusal } from "./stand-tx-refusal.ts";
import { isStandValidatorReadyNow } from "./stand-validator-ready.ts";
import { expectCustom } from "./stand-passport-commerce.ts";

import {
  withStandArtifactBindings,
  type StandArtifactBindings,
  standDeployDir
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
} = require("@solana/web3.js") as typeof import("@solana/web3.js");

const ROOT = path.resolve(__dirname, "../..");
const RPC = process.env.SVM_STAND_RPC ?? "http://127.0.0.1:8899";
const DEPLOY = standDeployDir();
const CORE_ID = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

/** KargainError ordinals */
const ERR = {
  AssetFrozen: 137,
  NotTransferDelegate: 138,
} as const;

/** mpl-core MplCoreError::InvalidAuthority */
const CORE_INVALID_AUTHORITY = 9;

/** HarnessIx Borsh discriminants (append-only enum order). */
const IX = {
  CoreCreateAsset: 21,
  CoreTransferOwnerToCustody: 22,
  CoreTransferDelegateToCustody: 23,
  CoreTransferCustodyToRecipient: 24,
  CoreTransferOwnerSkipFreeze: 25,
} as const;

const DELEGATE = { None: 0, Custody: 1, OwnerForeign: 2 } as const;

/** PluginType::TransferDelegate */
const PLUGIN_TRANSFER_DELEGATE = 3;
/** PluginAuthority::Owner */
const AUTH_OWNER = 1;
/** PluginAuthority::Address */
const AUTH_ADDRESS = 3;

function loadProgramId(): InstanceType<typeof PublicKey> {
  const kpPath = path.join(DEPLOY, "consignment_harness-keypair.json");
  if (!existsSync(kpPath)) {
    throw new Error(`missing ${kpPath} — build consignment-harness with cargo-build-sbf`);
  }
  const secret = Uint8Array.from(JSON.parse(readFileSync(kpPath, "utf8")));
  return Keypair.fromSecretKey(secret).publicKey;
}

async function airdrop(
  conn: InstanceType<typeof Connection>,
  kp: InstanceType<typeof Keypair>,
  sol = 20,
) {
  await standRequestAirdropAndConfirm(conn, kp.publicKey, sol * 1e9);
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

function coreOwner(data: Buffer): InstanceType<typeof PublicKey> {
  // BaseAssetV1: Key(1) + owner(32)
  return new PublicKey(data.subarray(1, 33));
}

/**
 * Scan PluginRegistryV1 for TransferDelegate and return authority type name.
 * Layout: after base + PluginHeader (key + u64 registry_offset) + plugin blobs,
 * registry = Key(4) + Vec<{plugin_type u8, PluginAuthority, offset u64}> + external vec.
 */
function transferDelegateAuthorityType(data: Buffer): "Owner" | "Address" | "Other" | "Absent" {
  // PluginHeaderV1 starts after BaseAssetV1. Walk: Key + owner32 + UpdateAuthority + name + uri + seq
  let i = 1; // skip Key
  i += 32; // owner
  const ua = data[i++]!;
  if (ua === 1) i += 32; // UpdateAuthority::Address
  // Collection has no pubkey beyond disc 0/1/2 — Collection=1 Address? Check UpdateAuthority enum:
  // None=0, Address=1+32, Collection=2+32
  if (ua === 2) i += 32;
  const nameLen = data.readUInt32LE(i);
  i += 4 + nameLen;
  const uriLen = data.readUInt32LE(i);
  i += 4 + uriLen;
  const seq = data[i++]!;
  if (seq === 1) i += 8; // Some(u64)

  // PluginHeaderV1: Key::PluginHeaderV1(3) + registry_offset u64
  if (data[i] !== 3) return "Absent";
  i += 1;
  const registryOffset = Number(data.readBigUInt64LE(i));
  i = registryOffset;

  // PluginRegistryV1: Key(4) + Vec<RegistryRecord>
  if (data[i] !== 4) return "Absent";
  i += 1;
  const n = data.readUInt32LE(i);
  i += 4;
  let found: "Owner" | "Address" | "Other" | "Absent" = "Absent";
  for (let r = 0; r < n; r++) {
    const pluginType = data[i++]!;
    const authDisc = data[i++]!;
    if (authDisc === AUTH_ADDRESS) i += 32;
    i += 8; // offset u64
    if (pluginType === PLUGIN_TRANSFER_DELEGATE) {
      if (authDisc === AUTH_OWNER) found = "Owner";
      else if (authDisc === AUTH_ADDRESS) found = "Address";
      else found = "Other";
    }
  }
  return found;
}

function createData(token: Buffer, frozen: boolean, delegateMode: number): Buffer {
  return Buffer.concat([
    Buffer.from([IX.CoreCreateAsset]),
    token,
    Buffer.from([frozen ? 1 : 0]),
    Buffer.from([delegateMode]),
  ]);
}

function createKeys(
  programId: InstanceType<typeof PublicKey>,
  asset: InstanceType<typeof PublicKey>,
  payer: InstanceType<typeof PublicKey>,
  owner: InstanceType<typeof PublicKey>,
  freeze: InstanceType<typeof PublicKey>,
) {
  return [
    { pubkey: asset, isSigner: false, isWritable: true },
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: owner, isSigner: false, isWritable: false },
    { pubkey: freeze, isSigner: false, isWritable: false },
    { pubkey: CORE_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
}

function ownerTransferKeys(
  asset: InstanceType<typeof PublicKey>,
  owner: InstanceType<typeof PublicKey>,
  custody: InstanceType<typeof PublicKey>,
  payer: InstanceType<typeof PublicKey>,
  ownerSigns: boolean,
) {
  return [
    { pubkey: asset, isSigner: false, isWritable: true },
    { pubkey: owner, isSigner: ownerSigns, isWritable: false },
    { pubkey: custody, isSigner: false, isWritable: false },
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: CORE_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
}

export async function probeValidator(rpc = RPC): Promise<boolean> {
  return isStandValidatorReadyNow({ rpcUrl: rpc });
}

export type LiveCoreCustodyResult = {
  ownerToCustody: { ownerBefore: string; ownerAfter: string };
  delegateToCustody: { ownerAfter: string };
  custodyToRecipient: {
    ownerAfter: string;
    transferDelegateAuthorityType: string;
  };
  factB: { assetFrozen: number; coreInvalidAuthority: number };
  negatives: {
    wrongToken: "InvalidSeeds" | number;
    foreignDelegate: number;
    unsignedOwner: "MissingRequiredSignature" | number;
  };
  artifacts: StandArtifactBindings;
};

export async function runLiveCoreCustody(): Promise<LiveCoreCustodyResult> {
  const conn = new Connection(RPC, "confirmed");
  const programId = loadProgramId();
  const payer = Keypair.generate();
  const seller = Keypair.generate();
  const recipient = Keypair.generate();
  await airdrop(conn, payer);
  await airdrop(conn, seller, 5);
  await airdrop(conn, recipient, 2);

  const [custodyPda] = pda(programId, [Buffer.from("custody")]);
  const [freezePda] = pda(programId, [Buffer.from("freeze")]);

  // ---- 1. Owner → custody ----
  const token1 = Buffer.alloc(32, 0xa1);
  const [asset1] = pda(programId, [Buffer.from("asset"), token1]);
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(programId, createKeys(programId, asset1, payer.publicKey, seller.publicKey, freezePda), createData(token1, false, DELEGATE.None)),
    ),
    [payer],
  );
  const ownerBefore1 = coreOwner((await conn.getAccountInfo(asset1))!.data as Buffer);
  assert.equal(ownerBefore1.toBase58(), seller.publicKey.toBase58());

  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        ownerTransferKeys(asset1, seller.publicKey, custodyPda, payer.publicKey, true),
        Buffer.concat([Buffer.from([IX.CoreTransferOwnerToCustody]), token1]),
      ),
    ),
    [payer, seller],
  );
  const ownerAfter1 = coreOwner((await conn.getAccountInfo(asset1))!.data as Buffer);
  assert.equal(ownerAfter1.toBase58(), custodyPda.toBase58(), "owner→custody must land on custody PDA");

  // ---- 2. Custody-as-delegate → custody ----
  const token2 = Buffer.alloc(32, 0xa2);
  const [asset2] = pda(programId, [Buffer.from("asset"), token2]);
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        createKeys(programId, asset2, payer.publicKey, seller.publicKey, freezePda),
        createData(token2, false, DELEGATE.Custody),
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
          { pubkey: asset2, isSigner: false, isWritable: true },
          { pubkey: custodyPda, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: CORE_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        Buffer.concat([Buffer.from([IX.CoreTransferDelegateToCustody]), token2]),
      ),
    ),
    [payer],
  );
  const ownerAfter2 = coreOwner((await conn.getAccountInfo(asset2))!.data as Buffer);
  assert.equal(ownerAfter2.toBase58(), custodyPda.toBase58(), "delegate→custody must land on custody");

  // ---- 3. Custody → recipient + fact (a) ----
  // Reuse asset2 (in custody) which still has TransferDelegate plugin.
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: asset2, isSigner: false, isWritable: true },
          { pubkey: custodyPda, isSigner: false, isWritable: false },
          { pubkey: recipient.publicKey, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: CORE_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        Buffer.concat([Buffer.from([IX.CoreTransferCustodyToRecipient]), token2]),
      ),
    ),
    [payer],
  );
  const ownerAfter3 = coreOwner((await conn.getAccountInfo(asset2))!.data as Buffer);
  assert.equal(ownerAfter3.toBase58(), recipient.publicKey.toBase58());

  const afterReturnData = (await conn.getAccountInfo(asset2))!.data as Buffer;
  const tdType = transferDelegateAuthorityType(afterReturnData);
  assert.equal(
    tdType,
    "Owner",
    `fact (a): TransferDelegate authority must reset to Owner, got ${tdType}`,
  );

  // ---- 4. Fact (b): AssetFrozen + Core InvalidAuthority ----
  const tokenFrozen = Buffer.alloc(32, 0xaf);
  const [assetFrozen] = pda(programId, [Buffer.from("asset"), tokenFrozen]);
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        createKeys(programId, assetFrozen, payer.publicKey, seller.publicKey, freezePda),
        createData(tokenFrozen, true, DELEGATE.None),
      ),
    ),
    [payer],
  );

  const assetFrozenCode = await expectCustom(
    conn,
    new Transaction().add(
      ix(
        programId,
        ownerTransferKeys(assetFrozen, seller.publicKey, custodyPda, payer.publicKey, true),
        Buffer.concat([Buffer.from([IX.CoreTransferOwnerToCustody]), tokenFrozen]),
      ),
    ),
    [payer, seller],
    ERR.AssetFrozen,
  );

  // Skip freeze gate → mpl-core InvalidAuthority(9). Must NOT use expectCustom:
  // Kargain ordinal 9 is NothingToRescue; Core Custom is custom_unattributed.
  const coreInvalidObs = await expectStandTransactionRefusal({
    conn,
    transaction: new Transaction().add(
      ix(
        programId,
        ownerTransferKeys(assetFrozen, seller.publicKey, custodyPda, payer.publicKey, true),
        Buffer.concat([Buffer.from([IX.CoreTransferOwnerSkipFreeze]), tokenFrozen]),
      ),
    ),
    signers: [payer, seller],
    expected: {
      kind: "custom_unattributed",
      ordinal: CORE_INVALID_AUTHORITY,
      failingProgram: CORE_ID.toBase58(),
    },
  });
  assert.equal(coreInvalidObs.kind, "custom_unattributed");
  const coreInvalidCode =
    coreInvalidObs.kind === "custom_unattributed"
      ? coreInvalidObs.ordinal
      : -1;

  // ---- 5. Negatives ----
  // Wrong token: asset for tokenW, instruction encodes tokenX
  const tokenW = Buffer.alloc(32, 0xb1);
  const tokenX = Buffer.alloc(32, 0xb2);
  const [assetW] = pda(programId, [Buffer.from("asset"), tokenW]);
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        createKeys(programId, assetW, payer.publicKey, seller.publicKey, freezePda),
        createData(tokenW, false, DELEGATE.None),
      ),
    ),
    [payer],
  );
  const wrongTokenObs = await expectStandTransactionRefusal({
    conn,
    transaction: new Transaction().add(
      ix(
        programId,
        ownerTransferKeys(assetW, seller.publicKey, custodyPda, payer.publicKey, true),
        Buffer.concat([Buffer.from([IX.CoreTransferOwnerToCustody]), tokenX]),
      ),
    ),
    signers: [payer, seller],
    expected: { kind: "native", name: "InvalidSeeds" },
  });
  assert.equal(wrongTokenObs.kind, "native");
  assert.equal(wrongTokenObs.name, "InvalidSeeds");
  assert.equal(typeof wrongTokenObs.index, "number");
  console.warn(
    `[svm-stand] core-custody refusal InvalidSeeds@${wrongTokenObs.index}`,
  );
  const wrongToken = "InvalidSeeds" as const;

  // Foreign TransferDelegate authority
  const tokenForeign = Buffer.alloc(32, 0xb3);
  const [assetForeign] = pda(programId, [Buffer.from("asset"), tokenForeign]);
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        createKeys(programId, assetForeign, payer.publicKey, seller.publicKey, freezePda),
        createData(tokenForeign, false, DELEGATE.OwnerForeign),
      ),
    ),
    [payer],
  );
  const foreignDelegate = await expectCustom(
    conn,
    new Transaction().add(
      ix(
        programId,
        [
          { pubkey: assetForeign, isSigner: false, isWritable: true },
          { pubkey: custodyPda, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: CORE_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        Buffer.concat([Buffer.from([IX.CoreTransferDelegateToCustody]), tokenForeign]),
      ),
    ),
    [payer],
    ERR.NotTransferDelegate,
  );

  // Unsigned owner
  const tokenUnsigned = Buffer.alloc(32, 0xb4);
  const [assetUnsigned] = pda(programId, [Buffer.from("asset"), tokenUnsigned]);
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      ix(
        programId,
        createKeys(programId, assetUnsigned, payer.publicKey, seller.publicKey, freezePda),
        createData(tokenUnsigned, false, DELEGATE.None),
      ),
    ),
    [payer],
  );
  const unsignedOwnerObs = await expectStandTransactionRefusal({
    conn,
    transaction: new Transaction().add(
      ix(
        programId,
        ownerTransferKeys(assetUnsigned, seller.publicKey, custodyPda, payer.publicKey, false),
        Buffer.concat([Buffer.from([IX.CoreTransferOwnerToCustody]), tokenUnsigned]),
      ),
    ),
    signers: [payer], // seller not signing
    expected: { kind: "native", name: "MissingRequiredSignature" },
  });
  assert.equal(unsignedOwnerObs.kind, "native");
  assert.equal(unsignedOwnerObs.name, "MissingRequiredSignature");
  assert.equal(typeof unsignedOwnerObs.index, "number");
  console.warn(
    `[svm-stand] core-custody refusal MissingRequiredSignature@${unsignedOwnerObs.index}`,
  );
  const unsignedOwner = "MissingRequiredSignature" as const;

  return withStandArtifactBindings({
    ownerToCustody: {
      ownerBefore: ownerBefore1.toBase58(),
      ownerAfter: ownerAfter1.toBase58(),
    },
    delegateToCustody: {
      ownerAfter: ownerAfter2.toBase58(),
    },
    custodyToRecipient: {
      ownerAfter: ownerAfter3.toBase58(),
      transferDelegateAuthorityType: tdType,
    },
    factB: {
      assetFrozen: assetFrozenCode,
      coreInvalidAuthority: coreInvalidCode,
    },
    negatives: {
      wrongToken,
      foreignDelegate,
      unsignedOwner,
    },
  });
}
