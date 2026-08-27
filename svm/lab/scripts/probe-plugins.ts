import {
  create,
  fetchAsset,
  transferV1,
  burnV1,
  updateV1,
  addPlugin,
  removePlugin,
  updatePlugin,
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
import {
  Connection,
  Keypair,
  SystemProgram,
  PublicKey,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
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
  const kp = umi.eddsa.createKeypairFromSecretKey(secretKey);
  return umi.use(signerIdentity(createSignerFromKeypair(umi, kp)));
}

async function airdrop(pk: PublicKey) {
  try {
    const s = await conn.requestAirdrop(pk, LAMPORTS_PER_SOL);
    await conn.confirmTransaction(s, "confirmed");
  } catch {
    /* funded */
  }
}

async function main() {
  const umi = makeUmi(payer.secretKey);
  const freezeAuthority = generateSigner(umi);
  await airdrop(new PublicKey(freezeAuthority.publicKey));

  // P-2 style
  {
    const asset = generateSigner(umi);
    const delegate = generateSigner(umi);
    const newOwner = generateSigner(umi);
    await create(umi, {
      asset,
      name: "p2",
      uri: "ar://p2",
      dataState: DataState.AccountState,
      plugins: [
        {
          type: "TransferDelegate",
          authority: { type: "Address", address: delegate.publicKey },
        },
      ],
    }).sendAndConfirm(umi);
    let a = await fetchAsset(umi, asset.publicKey);
    console.log("P2 hasDelegate", !!a.transferDelegate);
    await removePlugin(umi, {
      asset: asset.publicKey,
      plugin: { type: "TransferDelegate" },
    }).sendAndConfirm(umi);
    a = await fetchAsset(umi, asset.publicKey);
    console.log("P2 afterRemove", !!a.transferDelegate);
    await addPlugin(umi, {
      asset: asset.publicKey,
      plugin: {
        type: "TransferDelegate",
        authority: { type: "Address", address: delegate.publicKey },
      },
    }).sendAndConfirm(umi);
    await airdrop(new PublicKey(newOwner.publicKey));
    try {
      await transferV1(umi, {
        asset: asset.publicKey,
        newOwner: newOwner.publicKey,
        systemProgram: SYSTEM,
      }).sendAndConfirm(umi);
      a = await fetchAsset(umi, asset.publicKey);
      console.log("P2 TRANSFER OK afterTransferDelegate", !!a.transferDelegate);
    } catch (e) {
      console.log("P2 TRANSFER FAIL", String(e).split("\n")[0]);
      // try with collection none / log account size
      const info = await conn.getAccountInfo(new PublicKey(asset.publicKey));
      console.log(" asset len", info?.data.length);
    }
  }

  // freeze + transfer + thaw + burn
  {
    const asset = generateSigner(umi);
    const delegate = generateSigner(umi);
    const stranger = generateSigner(umi);
    await create(umi, {
      asset,
      name: "fz",
      uri: "ar://fz",
      dataState: DataState.AccountState,
      plugins: [
        {
          type: "PermanentFreezeDelegate",
          frozen: true,
          authority: { type: "Address", address: freezeAuthority.publicKey },
        },
        {
          type: "TransferDelegate",
          authority: { type: "Address", address: delegate.publicKey },
        },
      ],
    }).sendAndConfirm(umi);
    let rejected = false;
    try {
      await transferV1(umi, {
        asset: asset.publicKey,
        newOwner: stranger.publicKey,
        systemProgram: SYSTEM,
      }).sendAndConfirm(umi);
    } catch {
      rejected = true;
    }
    console.log("freeze rejects transfer", rejected);
    const umiFa = makeUmi(freezeAuthority.secretKey);
    await updatePlugin(umiFa, {
      asset: asset.publicKey,
      plugin: { type: "PermanentFreezeDelegate", frozen: false },
    }).sendAndConfirm(umiFa);
    try {
      await burnV1(umi, {
        asset: asset.publicKey,
        systemProgram: SYSTEM,
      }).sendAndConfirm(umi);
      console.log("thaw+burn OK");
    } catch (e) {
      console.log("burn FAIL", String(e).split("\n")[0]);
    }
  }

  // URI while frozen
  {
    const asset = generateSigner(umi);
    await create(umi, {
      asset,
      name: "uri",
      uri: "ar://before",
      dataState: DataState.AccountState,
      plugins: [
        {
          type: "PermanentFreezeDelegate",
          frozen: true,
          authority: { type: "Address", address: umi.identity.publicKey },
        },
      ],
    }).sendAndConfirm(umi);
    try {
      await updateV1(umi, {
        asset: asset.publicKey,
        newUri: "ar://after",
        systemProgram: SYSTEM,
      }).sendAndConfirm(umi);
      const a = await fetchAsset(umi, asset.publicKey);
      console.log("URI while frozen OK", a.uri);
    } catch (e) {
      console.log("URI while frozen FAIL", String(e).split("\n")[0]);
      // try update without systemProgram
      try {
        await updateV1(umi, {
          asset: asset.publicKey,
          newUri: "ar://after2",
        }).sendAndConfirm(umi);
        const a = await fetchAsset(umi, asset.publicKey);
        console.log("URI retry OK", a.uri);
      } catch (e2) {
        console.log("URI retry FAIL", String(e2).split("\n")[0]);
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
