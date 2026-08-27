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
  const programKp = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(
        fs.readFileSync(
          "programs/lab_harness/target/deploy/lab_harness-keypair.json",
          "utf8",
        ),
      ) as number[],
    ),
  );
  const programId = programKp.publicKey;
  const conn = new Connection(RPC, "confirmed");
  try {
    const s = await conn.requestAirdrop(payer.publicKey, 5 * LAMPORTS_PER_SOL);
    await conn.confirmTransaction(s, "confirmed");
  } catch {
    /* */
  }
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
  console.log({ programId: programId.toBase58(), asset: asset.toBase58() });
  const uri = Buffer.from("ar://dbg");
  const data = Buffer.alloc(1 + 32 + 4 + uri.length);
  data[0] = 0;
  Buffer.from(tokenId).copy(data, 1);
  data.writeUInt32LE(uri.length, 33);
  uri.copy(data, 37);
  const ix = new TransactionInstruction({
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
    data,
  });
  try {
    const sig = await sendAndConfirmTransaction(
      conn,
      new Transaction().add(ix),
      [payer],
      { commitment: "confirmed" },
    );
    console.log("sig", sig);
    const tx = await conn.getTransaction(sig, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });
    console.log("err", tx?.meta?.err);
    console.log("logs:\n" + (tx?.meta?.logMessages ?? []).join("\n"));
    console.log("asset", await conn.getAccountInfo(asset));
    console.log("state", await conn.getAccountInfo(state));
  } catch (e: unknown) {
    console.error("FAIL", e);
    const err = e as { getLogs?: () => Promise<string[]> };
    if (err.getLogs) console.log(await err.getLogs());
  }
}

main();
