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

async function main() {
  const RPC = "http://127.0.0.1:8899";
  const CORE = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
  const payer = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(
        fs.readFileSync(`${process.env.HOME}/.config/solana/id.json`, "utf8"),
      ) as number[],
    ),
  );
  const programId = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(
        fs.readFileSync(
          "programs/lab_harness/target/deploy/lab_harness-keypair.json",
          "utf8",
        ),
      ) as number[],
    ),
  ).publicKey;
  const conn = new Connection(RPC, "confirmed");
  for (let i = 0; i < 5; i++) {
    try {
      const s = await conn.requestAirdrop(payer.publicKey, 10 * LAMPORTS_PER_SOL);
      await conn.confirmTransaction(s, "confirmed");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  const bal = await conn.getBalance(payer.publicKey);
  console.log("balance", bal);
  const tokenId = crypto.getRandomValues(new Uint8Array(32));
  const [asset] = PublicKey.findProgramAddressSync(
    [Buffer.from("lab_asset"), tokenId],
    programId,
  );
  const [state] = PublicKey.findProgramAddressSync(
    [Buffer.from("lab_state"), tokenId],
    programId,
  );
  const [freeze] = PublicKey.findProgramAddressSync(
    [Buffer.from("lab_freeze")],
    programId,
  );
  const uri = Buffer.from("ar://thaw");
  const createData = Buffer.alloc(1 + 32 + 4 + uri.length);
  createData[0] = 1; // CreateFrozenWithDelegate
  Buffer.from(tokenId).copy(createData, 1);
  createData.writeUInt32LE(uri.length, 33);
  uri.copy(createData, 37);
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      new TransactionInstruction({
        programId,
        keys: [
          { pubkey: asset, isSigner: false, isWritable: true },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: payer.publicKey, isSigner: false, isWritable: false },
          { pubkey: freeze, isSigner: false, isWritable: false },
          { pubkey: CORE, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: state, isSigner: false, isWritable: true },
        ],
        data: createData,
      }),
    ),
    [payer],
  );
  console.log("before", await conn.getAccountInfo(asset));
  const thawData = Buffer.alloc(33);
  thawData[0] = 3;
  Buffer.from(tokenId).copy(thawData, 1);
  const sig = await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      new TransactionInstruction({
        programId,
        keys: [
          { pubkey: asset, isSigner: false, isWritable: true },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: payer.publicKey, isSigner: true, isWritable: false },
          { pubkey: freeze, isSigner: false, isWritable: false },
          { pubkey: CORE, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: thawData,
      }),
    ),
    [payer],
  );
  const tx = await conn.getTransaction(sig, {
    maxSupportedTransactionVersion: 0,
    commitment: "confirmed",
  });
  console.log("logs:\n" + (tx?.meta?.logMessages ?? []).join("\n"));
  const after = await conn.getAccountInfo(asset);
  console.log("after", after);
}

main().catch(console.error);
