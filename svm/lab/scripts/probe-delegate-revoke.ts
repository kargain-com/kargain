import {
  create,
  fetchAsset,
  transferV1,
  mplCore,
  DataState,
} from "@metaplex-foundation/mpl-core";
import {
  createSignerFromKeypair,
  generateSigner,
  publicKey,
  signerIdentity,
} from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { Keypair, SystemProgram, PublicKey, Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import fs from "node:fs";

const RPC = "http://127.0.0.1:8899";
const SYSTEM = publicKey(SystemProgram.programId.toBase58());
const raw = JSON.parse(
  fs.readFileSync(`${process.env.HOME}/.config/solana/id.json`, "utf8"),
) as number[];
const payer = Keypair.fromSecretKey(Uint8Array.from(raw));
const conn = new Connection(RPC, "confirmed");

function makeUmi(secretKey: Uint8Array) {
  const umi = createUmi(RPC).use(mplCore());
  return umi.use(
    signerIdentity(
      createSignerFromKeypair(
        umi,
        umi.eddsa.createKeypairFromSecretKey(secretKey),
      ),
    ),
  );
}

async function main() {
  const umi = makeUmi(payer.secretKey);
  const delegate = generateSigner(umi);
  const newOwner = generateSigner(umi);
  await conn.requestAirdrop(new PublicKey(newOwner.publicKey), LAMPORTS_PER_SOL).catch(() => undefined);

  // Case A: owner transfers while TransferDelegate present
  {
    const asset = generateSigner(umi);
    await create(umi, {
      asset,
      name: "a",
      uri: "ar://a",
      dataState: DataState.AccountState,
      plugins: [
        {
          type: "TransferDelegate",
          authority: { type: "Address", address: delegate.publicKey },
        },
      ],
    }).sendAndConfirm(umi);
    let a = await fetchAsset(umi, asset.publicKey);
    console.log("A before", !!a.transferDelegate, a.transferDelegate);
    await transferV1(umi, {
      asset: asset.publicKey,
      newOwner: newOwner.publicKey,
      systemProgram: SYSTEM,
    }).sendAndConfirm(umi);
    a = await fetchAsset(umi, asset.publicKey);
    console.log("A after owner-xfer", !!a.transferDelegate, a.transferDelegate, "owner", a.owner);
  }

  // Case B: transfer via TransferDelegate authority
  {
    const asset = generateSigner(umi);
    await create(umi, {
      asset,
      name: "b",
      uri: "ar://b",
      dataState: DataState.AccountState,
      plugins: [
        {
          type: "TransferDelegate",
          authority: { type: "Address", address: delegate.publicKey },
        },
      ],
    }).sendAndConfirm(umi);
    const umiDel = makeUmi(delegate.secretKey);
    // fund delegate
    try {
      const s = await conn.requestAirdrop(new PublicKey(delegate.publicKey), LAMPORTS_PER_SOL);
      await conn.confirmTransaction(s, "confirmed");
    } catch { /* */ }
    let a = await fetchAsset(umi, asset.publicKey);
    console.log("B before", !!a.transferDelegate, a.transferDelegate);
    await transferV1(umiDel, {
      asset: asset.publicKey,
      newOwner: newOwner.publicKey,
      authority: delegate,
      systemProgram: SYSTEM,
    }).sendAndConfirm(umiDel);
    a = await fetchAsset(umi, asset.publicKey);
    console.log("B after delegate-xfer", !!a.transferDelegate, a.transferDelegate, "owner", a.owner);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
