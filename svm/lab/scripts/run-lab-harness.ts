/**
 * S3 laboratory harness runner — П-1 PDA CreateV1 CPI + thaw+burn same ix.
 * Requires: local validator started via scripts/start-validator.sh (loads Core + harness).
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RPC = process.env.SVM_LAB_RPC ?? "http://127.0.0.1:8899";
const CORE_ID = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
const ASSET_SEED = Buffer.from("lab_asset");
const STATE_SEED = Buffer.from("lab_state");
const FREEZE_SEED = Buffer.from("lab_freeze");

type LabIxKind =
  | "CreatePdaAsset"
  | "CreateFrozenWithDelegate"
  | "CreateWithProgramFreezeAuth"
  | "ThawAndBurn";

function loadKeypair(p: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(p, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

/** Borsh enum encoding matching lab_harness::LabIx (borsh 1.x). */
function encodeIx(
  kind: LabIxKind,
  tokenId: Uint8Array,
  uri?: string,
): Buffer {
  const disc =
    kind === "CreatePdaAsset"
      ? 0
      : kind === "CreateFrozenWithDelegate"
        ? 1
        : kind === "CreateWithProgramFreezeAuth"
          ? 2
          : 3;
  if (kind === "ThawAndBurn") {
    const out = Buffer.alloc(1 + 32);
    out.writeUInt8(disc, 0);
    Buffer.from(tokenId).copy(out, 1);
    return out;
  }
  const uriBuf = Buffer.from(uri ?? "", "utf8");
  const out = Buffer.alloc(1 + 32 + 4 + uriBuf.length);
  out.writeUInt8(disc, 0);
  Buffer.from(tokenId).copy(out, 1);
  out.writeUInt32LE(uriBuf.length, 33);
  uriBuf.copy(out, 37);
  return out;
}

function createKeys(
  programId: PublicKey,
  asset: PublicKey,
  payer: PublicKey,
  freeze: PublicKey,
  state: PublicKey | null,
): { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] {
  const keys = [
    { pubkey: asset, isSigner: false, isWritable: true },
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: payer, isSigner: false, isWritable: false },
    { pubkey: freeze, isSigner: false, isWritable: false },
    { pubkey: CORE_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  if (state) {
    keys.push({ pubkey: state, isSigner: false, isWritable: true });
  }
  return keys;
}

async function main() {
  const connection = new Connection(RPC, "confirmed");
  const payer = loadKeypair(
    process.env.SOLANA_KEYPAIR ?? `${process.env.HOME}/.config/solana/id.json`,
  );
  const harnessPath =
    process.env.LAB_HARNESS_SO ??
    path.resolve(
      __dirname,
      "../programs/lab_harness/target/deploy/lab_harness.so",
    );
  const programKpPath = path.resolve(
    path.dirname(harnessPath),
    "lab_harness-keypair.json",
  );
  if (!fs.existsSync(harnessPath) || !fs.existsSync(programKpPath)) {
    console.error(
      JSON.stringify({
        id: "P-1",
        ok: false,
        detail: `missing harness so/keypair under ${path.dirname(harnessPath)}`,
      }),
    );
    process.exit(1);
  }
  const programId = loadKeypair(programKpPath).publicKey;

  try {
    const s = await connection.requestAirdrop(
      payer.publicKey,
      50 * LAMPORTS_PER_SOL,
    );
    await connection.confirmTransaction(s, "confirmed");
  } catch {
    /* funded */
  }

  const existing = await connection.getAccountInfo(programId);
  if (!existing?.executable) {
    throw new Error(
      `lab_harness ${programId.toBase58()} not executable — start validator via scripts/start-validator.sh`,
    );
  }
  console.error(`lab_harness loaded: ${programId.toBase58()}`);

  const results: Array<{
    id: string;
    ok: boolean;
    detail: string;
    metrics?: Record<string, unknown>;
  }> = [];
  const [freezePda] = PublicKey.findProgramAddressSync([FREEZE_SEED], programId);

  // П-1: CreatePdaAsset via invoke_signed on asset PDA
  {
    const tokenId = crypto.getRandomValues(new Uint8Array(32));
    const [assetPda] = PublicKey.findProgramAddressSync(
      [ASSET_SEED, tokenId],
      programId,
    );
    const [statePda] = PublicKey.findProgramAddressSync(
      [STATE_SEED, tokenId],
      programId,
    );
    try {
      const data = encodeIx("CreatePdaAsset", tokenId, "ar://lab-p1");
      const sig = await sendAndConfirmTransaction(
        connection,
        new Transaction().add(
          new TransactionInstruction({
            programId,
            keys: createKeys(
              programId,
              assetPda,
              payer.publicKey,
              freezePda,
              statePda,
            ),
            data,
          }),
        ),
        [payer],
        { commitment: "confirmed" },
      );
      const tx = await connection.getTransaction(sig, {
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
      });
      const assetInfo = await connection.getAccountInfo(assetPda);
      const stateInfo = await connection.getAccountInfo(statePda);
      const logOk = (tx?.meta?.logMessages ?? []).some((l) =>
        l.includes("CreatePdaAsset ok"),
      );
      results.push({
        id: "P-1",
        ok:
          logOk &&
          assetInfo != null &&
          assetInfo.owner.equals(CORE_ID) &&
          assetInfo.data.length > 64 &&
          stateInfo != null,
        detail: `assetPda=${assetPda.toBase58()} owner=${assetInfo?.owner.toBase58() ?? "none"} len=${assetInfo?.data.length ?? 0} stateLen=${stateInfo?.data.length ?? 0} cu=${tx?.meta?.computeUnitsConsumed ?? -1} logOk=${logOk}`,
        metrics: {
          assetPda: assetPda.toBase58(),
          computeUnits: tx?.meta?.computeUnitsConsumed ?? -1,
          dataLen: assetInfo?.data.length ?? 0,
          stateExists: stateInfo != null,
        },
      });
    } catch (e) {
      results.push({ id: "P-1", ok: false, detail: String(e) });
    }
  }

  // П-3: program id recorded as PermanentFreeze Address authority
  {
    const tokenId = crypto.getRandomValues(new Uint8Array(32));
    const [assetPda] = PublicKey.findProgramAddressSync(
      [ASSET_SEED, tokenId],
      programId,
    );
    const [statePda] = PublicKey.findProgramAddressSync(
      [STATE_SEED, tokenId],
      programId,
    );
    try {
      const data = encodeIx(
        "CreateWithProgramFreezeAuth",
        tokenId,
        "ar://lab-p3-prog",
      );
      const sig = await sendAndConfirmTransaction(
        connection,
        new Transaction().add(
          new TransactionInstruction({
            programId,
            keys: createKeys(
              programId,
              assetPda,
              payer.publicKey,
              freezePda,
              statePda,
            ),
            data,
          }),
        ),
        [payer],
        { commitment: "confirmed" },
      );
      const tx = await connection.getTransaction(sig, {
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
      });
      const assetInfo = await connection.getAccountInfo(assetPda);
      const logOk = (tx?.meta?.logMessages ?? []).some((l) =>
        l.includes("program_freeze=true"),
      );
      // Authority pubkey is embedded in Core account data; prove create accepted Address(program_id).
      const containsProgramId =
        assetInfo != null &&
        assetInfo.data.includes(programId.toBytes()[0]) &&
        Buffer.from(assetInfo.data).includes(Buffer.from(programId.toBytes()));
      results.push({
        id: "P-3-program-address",
        ok: logOk && assetInfo != null && assetInfo.owner.equals(CORE_ID) && containsProgramId,
        detail: `logOk=${logOk} len=${assetInfo?.data.length ?? 0} containsProgramId=${containsProgramId} programId=${programId.toBase58()}`,
      });
    } catch (e) {
      results.push({ id: "P-3-program-address", ok: false, detail: String(e) });
    }
  }

  // Freeze: thaw + burn in one instruction (freeze PDA authority)
  {
    const tokenId = crypto.getRandomValues(new Uint8Array(32));
    const [assetPda] = PublicKey.findProgramAddressSync(
      [ASSET_SEED, tokenId],
      programId,
    );
    const [statePda] = PublicKey.findProgramAddressSync(
      [STATE_SEED, tokenId],
      programId,
    );
    try {
      await sendAndConfirmTransaction(
        connection,
        new Transaction().add(
          new TransactionInstruction({
            programId,
            keys: createKeys(
              programId,
              assetPda,
              payer.publicKey,
              freezePda,
              statePda,
            ),
            data: encodeIx("CreateFrozenWithDelegate", tokenId, "ar://lab-thaw"),
          }),
        ),
        [payer],
        { commitment: "confirmed" },
      );
      const before = await connection.getAccountInfo(assetPda);
      const thawSig = await sendAndConfirmTransaction(
        connection,
        new Transaction().add(
          new TransactionInstruction({
            programId,
            keys: [
              { pubkey: assetPda, isSigner: false, isWritable: true },
              { pubkey: payer.publicKey, isSigner: true, isWritable: true },
              { pubkey: payer.publicKey, isSigner: true, isWritable: false },
              { pubkey: freezePda, isSigner: false, isWritable: false },
              { pubkey: CORE_ID, isSigner: false, isWritable: false },
              {
                pubkey: SystemProgram.programId,
                isSigner: false,
                isWritable: false,
              },
            ],
            data: encodeIx("ThawAndBurn", tokenId),
          }),
        ),
        [payer],
        { commitment: "confirmed" },
      );
      const thawTx = await connection.getTransaction(thawSig, {
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
      });
      const after = await connection.getAccountInfo(assetPda);
      const logOk = (thawTx?.meta?.logMessages ?? []).some((l) =>
        l.includes("ThawAndBurn ok"),
      );
      const burnedTombstone =
        after != null &&
        after.data.length === 1 &&
        after.data[0] === 0 &&
        after.owner.equals(CORE_ID);
      const fullyClosed = after == null;
      results.push({
        id: "freeze-thaw-burn-same-ix",
        ok: before != null && before.data.length > 64 && logOk && (fullyClosed || burnedTombstone),
        detail: `beforeLen=${before?.data.length ?? 0} after=${fullyClosed ? "closed" : `tombstone len=${after?.data.length}`} logOk=${logOk} (Core Burn leaves 1-byte tombstone)`,
      });
    } catch (e) {
      results.push({
        id: "freeze-thaw-burn-same-ix",
        ok: false,
        detail: String(e),
      });
    }
  }

  console.log(JSON.stringify(results, null, 2));
  process.exit(results.some((r) => !r.ok) ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
