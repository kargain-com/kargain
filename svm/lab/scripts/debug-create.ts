import {
  create,
  fetchAsset,
  transfer,
  DataState,
  mplCore,
} from "@metaplex-foundation/mpl-core";
import {
  createSignerFromKeypair,
  generateSigner,
  signerIdentity,
} from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import fs from "node:fs";

const RPC = "http://127.0.0.1:8899";
const raw = JSON.parse(
  fs.readFileSync(`${process.env.HOME}/.config/solana/id.json`, "utf8"),
) as number[];
const payer = Keypair.fromSecretKey(Uint8Array.from(raw));
const umi = createUmi(RPC).use(mplCore());
const secret = umi.eddsa.createKeypairFromSecretKey(payer.secretKey);
umi.use(signerIdentity(createSignerFromKeypair(umi, secret)));

const asset = generateSigner(umi);
const newOwner = generateSigner(umi);

await create(umi, {
  asset,
  name: "dbg",
  uri: "ar://dbg",
  dataState: DataState.AccountState,
}).sendAndConfirm(umi);

const fetched = await fetchAsset(umi, asset.publicKey);
console.log("fetched keys", Object.keys(fetched));
console.log("uri", fetched.uri);
console.log("owner", fetched.owner);
console.log("json", JSON.stringify(fetched, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2).slice(0, 1500));

const conn = new Connection(RPC, "confirmed");
const info = await conn.getAccountInfo(new PublicKey(asset.publicKey));
console.log("account owner", info?.owner.toBase58(), "len", info?.data.length, "first bytes", info?.data.slice(0, 8));

try {
  await transfer(umi, {
    asset: asset.publicKey,
    newOwner: newOwner.publicKey,
  }).sendAndConfirm(umi);
  console.log("transfer OK");
} catch (e) {
  console.error("transfer FAIL", e);
}
