import {
  create,
  createV1,
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
  type KeypairSigner,
} from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  Connection,
  Keypair,
  SystemProgram,
  PublicKey,
} from "@solana/web3.js";
import fs from "node:fs";

const RPC = "http://127.0.0.1:8899";
const SYSTEM = publicKey(SystemProgram.programId.toBase58());
const raw = JSON.parse(
  fs.readFileSync(`${process.env.HOME}/.config/solana/id.json`, "utf8"),
) as number[];
const payer = Keypair.fromSecretKey(Uint8Array.from(raw));
const umi = createUmi(RPC).use(mplCore());
umi.use(
  signerIdentity(
    createSignerFromKeypair(
      umi,
      umi.eddsa.createKeypairFromSecretKey(payer.secretKey),
    ),
  ),
);
const conn = new Connection(RPC, "confirmed");

async function tryCreate(
  label: string,
  fn: (asset: KeypairSigner) => Promise<unknown>,
) {
  const asset = generateSigner(umi);
  try {
    await fn(asset);
    const info = await conn.getAccountInfo(new PublicKey(asset.publicKey));
    const fetched = await fetchAsset(umi, asset.publicKey);
    console.log(
      label,
      "OK len",
      info?.data.length,
      "owner",
      info?.owner.toBase58().slice(0, 12),
      "uri",
      fetched.uri,
    );
    const newOwner = generateSigner(umi);
    try {
      await transferV1(umi, {
        asset: asset.publicKey,
        newOwner: newOwner.publicKey,
        systemProgram: SYSTEM,
      }).sendAndConfirm(umi);
      console.log(label, "TRANSFER OK");
    } catch (e) {
      console.log(label, "TRANSFER FAIL", String(e).split("\n")[0]);
    }
  } catch (e) {
    console.log(label, "CREATE FAIL", String(e).split("\n").slice(0, 2).join(" | "));
  }
}

async function main() {
  await tryCreate("create+AccountState", (asset) =>
    create(umi, {
      asset,
      name: "t",
      uri: "ar://t",
      dataState: DataState.AccountState,
    }).sendAndConfirm(umi),
  );
  await tryCreate("createV1+AccountState", (asset) =>
    createV1(umi, {
      asset,
      name: "t",
      uri: "ar://t",
      dataState: DataState.AccountState,
    }).sendAndConfirm(umi),
  );
  await tryCreate("create no dataState", (asset) =>
    create(umi, { asset, name: "t", uri: "ar://t" }).sendAndConfirm(umi),
  );
  await tryCreate("createV1 no dataState", (asset) =>
    createV1(umi, { asset, name: "t", uri: "ar://t" }).sendAndConfirm(umi),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
